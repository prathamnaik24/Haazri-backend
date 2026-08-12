import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

export class AttendanceService {
  /**
   * Log employee check-in for the current date.
   */
  async checkIn(personId, tenantId, metadata = {}) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Verify the employee belongs to this tenant
      const personCheck = await client.query(
        'SELECT id FROM persons WHERE id = $1 AND organization_id = $2 AND is_active = true',
        [personId, tenantId]
      );

      if (personCheck.rows.length === 0) {
        throw new AppError('Employee not found or is currently inactive', 404);
      }

      // 2. Check if a check-in already exists for today
      const existing = await client.query(
        'SELECT id FROM attendance WHERE person_id = $1 AND work_date = CURRENT_DATE',
        [personId]
      );

      if (existing.rows.length > 0) {
        throw new AppError('Already checked in for today', 400);
      }

      // 3. Create check-in record
      const result = await client.query(
        `INSERT INTO attendance (person_id, work_date, check_in_time, status, metadata)
         VALUES ($1, CURRENT_DATE, CURRENT_TIMESTAMP, 'Present', $2::jsonb)
         RETURNING id, work_date, check_in_time, status, metadata`,
        [personId, JSON.stringify(metadata)]
      );

      // 4. Log in audit trail
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'attendance', $2, 'CREATE', $3::jsonb, $4, 'Daily check-in registered')`,
        [
          tenantId,
          result.rows[0].id,
          JSON.stringify({ work_date: result.rows[0].work_date, check_in_time: result.rows[0].check_in_time }),
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
   * Log employee check-out for the current date.
   */
  async checkOut(personId, tenantId) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Find the active check-in row for today (check_in_time present, check_out_time missing)
      const existing = await client.query(
        `SELECT id, check_in_time, metadata 
         FROM attendance 
         WHERE person_id = $1 AND work_date = CURRENT_DATE AND check_out_time IS NULL`,
        [personId]
      );

      if (existing.rows.length === 0) {
        throw new AppError('No active check-in record found for today, or check-out is already complete', 400);
      }

      const attendanceRow = existing.rows[0];
      const checkInTime = new Date(attendanceRow.check_in_time);
      const checkOutTime = new Date();

      // Calculate total duration in hours (rounded to 2 decimal places)
      const diffMs = checkOutTime.getTime() - checkInTime.getTime();
      const totalHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;

      // Merge total_hours into metadata
      const updatedMetadata = {
        ...attendanceRow.metadata,
        total_hours: totalHours,
      };

      // 2. Perform the check-out update
      const result = await client.query(
        `UPDATE attendance 
         SET check_out_time = CURRENT_TIMESTAMP, 
             metadata = $1::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING id, work_date, check_in_time, check_out_time, status, metadata`,
        [JSON.stringify(updatedMetadata), attendanceRow.id]
      );

      // 3. Log in audit trail
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'attendance', $2, 'UPDATE', $3::jsonb, $4, 'Daily check-out completed')`,
        [
          tenantId,
          result.rows[0].id,
          JSON.stringify({ check_out_time: result.rows[0].check_out_time, total_hours: totalHours }),
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
   * Fetch own history logs for the employee.
   */
  async getMyHistory(personId, options = {}) {
    const { limit = 30, offset = 0 } = options;

    const result = await db.query(
      `SELECT id, work_date, check_in_time, check_out_time, status, metadata 
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
   * Fetch subordinate team logs using the manager's position ltree path containment.
   */
  async getTeamHistory(managerPositionPath, tenantId, options = {}) {
    if (!managerPositionPath) {
      throw new AppError('Manager position path context is required to query subordinate team logs', 400);
    }

    const { limit = 50, offset = 0 } = options;

    // Use <@ ltree containment operator: pos.path is a descendant of or equal to managerPositionPath
    const result = await db.query(
      `SELECT 
         a.id, a.work_date, a.check_in_time, a.check_out_time, a.status, a.metadata,
         p.id AS person_id, p.first_name, p.last_name, p.email,
         pos.title AS position_title, pos.path AS position_path
       FROM attendance a
       JOIN persons p ON p.id = a.person_id
       JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       JOIN positions pos ON pos.id = pa.position_id
       WHERE p.organization_id = $1 AND pos.path <@ $2::ltree
       ORDER BY a.work_date DESC, p.last_name ASC, p.first_name ASC
       LIMIT $3 OFFSET $4`,
      [tenantId, managerPositionPath, limit, offset]
    );

    const countResult = await db.query(
      `SELECT COUNT(a.id)
       FROM attendance a
       JOIN persons p ON p.id = a.person_id
       JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= current_date)
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
        metadata: row.metadata,
        employee: {
          id: row.person_id,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
          position: {
            title: row.position_title,
            path: row.position_path,
          },
        },
      })),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }
}
