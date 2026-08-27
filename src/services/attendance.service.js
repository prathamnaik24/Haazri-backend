import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

/**
 * Fetch the reporting time config for an organisation.
 * Returns { reporting_time: '09:30', timezone: 'Asia/Kolkata' }
 */
async function getReportingConfig(orgId) {
  const res = await db.query(
    `SELECT setting_value, timezone
     FROM office_settings
     WHERE organization_id = $1 AND setting_key = 'default_reporting_time'
       AND scope_type = 'org'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [orgId]
  );
  return {
    reporting_time: res.rows[0]?.setting_value || '09:30',
    timezone:       res.rows[0]?.timezone       || 'Asia/Kolkata',
  };
}

/**
 * Compute punctuality status comparing now (UTC) against the expected check-in time.
 */
function computePunctuality(nowUtc, reportingTimeStr, tz) {
  const nowLocal = toZonedTime(nowUtc, tz);
  const [rHour, rMin] = reportingTimeStr.split(':').map(Number);

  const expectedLocal = new Date(nowLocal);
  expectedLocal.setHours(rHour, rMin, 0, 0);
  const expectedUtc = fromZonedTime(expectedLocal, tz);

  const diffMinutes = Math.round((nowUtc - expectedUtc) / 60_000);

  if (diffMinutes > 15)       return { punctuality_status: 'LATE',     late_by_minutes: diffMinutes };
  if (diffMinutes < -30)      return { punctuality_status: 'EARLY',    late_by_minutes: 0 };
  return                             { punctuality_status: 'ON_TIME',  late_by_minutes: 0 };
}

export class AttendanceService {
  /**
   * Log employee check-in for the current date (with punctuality computation).
   */
  async checkIn(personId, tenantId, metadata = {}) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Verify employee belongs to this tenant
      const personCheck = await client.query(
        'SELECT id FROM persons WHERE id = $1 AND organization_id = $2 AND is_active = true',
        [personId, tenantId]
      );
      if (personCheck.rows.length === 0) {
        throw new AppError('Employee not found or is currently inactive', 404);
      }

      // 2. Check no duplicate check-in today
      const existing = await client.query(
        'SELECT id FROM attendance WHERE person_id = $1 AND work_date = CURRENT_DATE',
        [personId]
      );
      if (existing.rows.length > 0) {
        throw new AppError('Already checked in for today', 400);
      }

      // 3. Get reporting config and compute punctuality
      const config = await getReportingConfig(tenantId);
      const nowUtc = new Date();
      const { punctuality_status, late_by_minutes } = computePunctuality(
        nowUtc, config.reporting_time, config.timezone
      );

      // 4. Insert check-in record
      const result = await client.query(
        `INSERT INTO attendance
           (person_id, work_date, check_in_time, status, punctuality_status, late_by_minutes, reporting_time_used, metadata)
         VALUES ($1, CURRENT_DATE, $2, 'Present', $3, $4, $5::time, $6::jsonb)
         RETURNING id, work_date, check_in_time, status, punctuality_status, late_by_minutes, metadata`,
        [personId, nowUtc, punctuality_status, late_by_minutes, config.reporting_time, JSON.stringify(metadata)]
      );

      // 5. Audit
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'attendance', $2, 'CREATE', $3::jsonb, $4, 'Daily check-in registered')`,
        [
          tenantId,
          result.rows[0].id,
          JSON.stringify({ work_date: result.rows[0].work_date, punctuality_status, late_by_minutes }),
          personId,
        ]
      );

      await client.query('COMMIT');
      return result.rows[0];

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Log employee check-out for the current date (computes working_minutes and HALF_DAY logic).
   */
  async checkOut(personId, tenantId) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        `SELECT id, check_in_time, punctuality_status, metadata
         FROM attendance
         WHERE person_id = $1 AND work_date = CURRENT_DATE AND check_out_time IS NULL`,
        [personId]
      );
      if (existing.rows.length === 0) {
        throw new AppError('No active check-in record found for today', 400);
      }

      const row = existing.rows[0];
      const checkInTime  = new Date(row.check_in_time);
      const checkOutTime = new Date();
      const workingMinutes = Math.round((checkOutTime - checkInTime) / 60_000);

      // Mark HALF_DAY if worked less than 4 hours
      const finalStatus = workingMinutes < 240 ? 'HALF_DAY' : row.punctuality_status;

      const updatedMetadata = {
        ...row.metadata,
        total_hours: Math.round((workingMinutes / 60) * 100) / 100,
      };

      const result = await client.query(
        `UPDATE attendance
         SET check_out_time   = $1,
             working_minutes  = $2,
             punctuality_status = $3,
             metadata         = $4::jsonb,
             updated_at       = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING id, work_date, check_in_time, check_out_time, punctuality_status, working_minutes, metadata`,
        [checkOutTime, workingMinutes, finalStatus, JSON.stringify(updatedMetadata), row.id]
      );

      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'attendance', $2, 'UPDATE', $3::jsonb, $4, 'Daily check-out completed')`,
        [tenantId, row.id, JSON.stringify({ working_minutes: workingMinutes, final_status: finalStatus }), personId]
      );

      await client.query('COMMIT');
      return result.rows[0];

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch own attendance history.
   */
  async getMyHistory(personId, options = {}) {
    const { limit = 30, offset = 0 } = options;

    const result = await db.query(
      `SELECT id, work_date, check_in_time, check_out_time, status, punctuality_status,
              late_by_minutes, working_minutes, metadata
       FROM attendance
       WHERE person_id = $1
       ORDER BY work_date DESC
       LIMIT $2 OFFSET $3`,
      [personId, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(id) FROM attendance WHERE person_id = $1',
      [personId]
    );

    return {
      history: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  /**
   * Summary stats for the logged-in employee.
   */
  async getMySummary(personId, options = {}) {
    const { from, to } = options;
    const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const toDate   = to   || new Date().toISOString().split('T')[0];

    const result = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE punctuality_status = 'ON_TIME') AS on_time_count,
         COUNT(*) FILTER (WHERE punctuality_status = 'LATE')    AS late_count,
         COUNT(*) FILTER (WHERE punctuality_status = 'EARLY')   AS early_count,
         COUNT(*) FILTER (WHERE punctuality_status = 'HALF_DAY') AS half_day_count,
         COUNT(*) FILTER (WHERE punctuality_status = 'ABSENT')  AS absent_count,
         ROUND(AVG(late_by_minutes) FILTER (WHERE punctuality_status = 'LATE'), 1) AS avg_late_minutes,
         ROUND(AVG(working_minutes) / 60.0, 2) AS avg_working_hours,
         COUNT(*) AS total_working_days
       FROM attendance
       WHERE person_id = $1 AND work_date BETWEEN $2 AND $3`,
      [personId, fromDate, toDate]
    );

    return { ...result.rows[0], from: fromDate, to: toDate };
  }

  /**
   * Fetch subordinate team attendance using ltree path containment.
   */
  async getTeamHistory(managerPositionPath, tenantId, options = {}) {
    if (!managerPositionPath) {
      throw new AppError('Manager position path context is required', 400);
    }
    const { limit = 50, offset = 0 } = options;

    const result = await db.query(
      `SELECT
         a.id, a.work_date, a.check_in_time, a.check_out_time, a.status,
         a.punctuality_status, a.late_by_minutes, a.working_minutes, a.metadata,
         p.id AS person_id, p.first_name, p.last_name, p.email,
         pos.title AS position_title, pos.path AS position_path
       FROM attendance a
       JOIN persons p ON p.id = a.person_id
       JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true
         AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       JOIN positions pos ON pos.id = pa.position_id
       WHERE p.organization_id = $1 AND pos.path <@ $2::ltree
       ORDER BY a.work_date DESC, p.last_name ASC
       LIMIT $3 OFFSET $4`,
      [tenantId, managerPositionPath, limit, offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(a.id)
       FROM attendance a
       JOIN persons p ON p.id = a.person_id
       JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true
         AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       JOIN positions pos ON pos.id = pa.position_id
       WHERE p.organization_id = $1 AND pos.path <@ $2::ltree`,
      [tenantId, managerPositionPath]
    );

    return {
      team_history: result.rows.map((row) => ({
        id: row.id,
        work_date: row.work_date,
        check_in_time: row.check_in_time,
        check_out_time: row.check_out_time,
        status: row.status,
        punctuality_status: row.punctuality_status,
        late_by_minutes: row.late_by_minutes,
        working_minutes: row.working_minutes,
        metadata: row.metadata,
        employee: {
          id: row.person_id,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          position: { title: row.position_title, path: row.position_path },
        },
      })),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  /**
   * Daily org-wide attendance report (Org Admin / HR).
   */
  async getDailyReport(tenantId, date) {
    const reportDate = date || new Date().toISOString().split('T')[0];

    const result = await db.query(
      `SELECT
         p.id AS person_id, p.first_name, p.last_name, p.email, p.employee_id,
         pos.title AS position_title,
         a.check_in_time, a.check_out_time, a.punctuality_status,
         a.late_by_minutes, a.working_minutes,
         COALESCE(a.punctuality_status, 'ABSENT') AS final_status
       FROM persons p
       LEFT JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true
         AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       LEFT JOIN positions pos ON pos.id = pa.position_id
       LEFT JOIN attendance a ON a.person_id = p.id AND a.work_date = $2
       WHERE p.organization_id = $1 AND p.is_active = true
       ORDER BY p.last_name ASC, p.first_name ASC`,
      [tenantId, reportDate]
    );

    const summary = {
      date: reportDate,
      total_employees: result.rows.length,
      present: result.rows.filter(r => r.final_status !== 'ABSENT').length,
      on_time: result.rows.filter(r => r.final_status === 'ON_TIME').length,
      late:    result.rows.filter(r => r.final_status === 'LATE').length,
      early:   result.rows.filter(r => r.final_status === 'EARLY').length,
      half_day: result.rows.filter(r => r.final_status === 'HALF_DAY').length,
      absent:  result.rows.filter(r => r.final_status === 'ABSENT').length,
    };

    return { summary, records: result.rows };
  }

  /**
   * Date-range report with optional filters.
   */
  async getRangeReport(tenantId, { from, to, personId }) {
    const fromDate = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    const toDate   = to   || new Date().toISOString().split('T')[0];

    const params = [tenantId, fromDate, toDate];
    let personFilter = '';
    if (personId) {
      params.push(personId);
      personFilter = `AND p.id = $${params.length}`;
    }

    const result = await db.query(
      `SELECT
         p.id AS person_id, p.first_name, p.last_name, p.email, p.employee_id,
         COUNT(*) AS total_days,
         COUNT(*) FILTER (WHERE a.punctuality_status = 'ON_TIME')  AS on_time,
         COUNT(*) FILTER (WHERE a.punctuality_status = 'LATE')     AS late,
         COUNT(*) FILTER (WHERE a.punctuality_status = 'EARLY')    AS early,
         COUNT(*) FILTER (WHERE a.punctuality_status = 'HALF_DAY') AS half_day,
         ROUND(AVG(a.late_by_minutes) FILTER (WHERE a.punctuality_status = 'LATE'), 1) AS avg_late_minutes,
         ROUND(AVG(a.working_minutes) / 60.0, 2) AS avg_working_hours
       FROM persons p
       JOIN attendance a ON a.person_id = p.id AND a.work_date BETWEEN $2 AND $3
       WHERE p.organization_id = $1 AND p.is_active = true ${personFilter}
       GROUP BY p.id
       ORDER BY p.last_name ASC, p.first_name ASC`,
      params
    );

    return { from: fromDate, to: toDate, records: result.rows };
  }
}
