import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

export class LeaveService {
  /**
   * Submit a new leave request and atomically deduct leave balance.
   */
  async requestLeave(personId, tenantId, body) {
    const { leave_type_id, start_date, end_date, reason } = body;

    if (!leave_type_id || !start_date || !end_date) {
      throw new AppError('leave_type_id, start_date, and end_date are required', 400);
    }

    const start = new Date(start_date);
    const end = new Date(end_date);
    if (end < start) {
      throw new AppError('end_date must be on or after start_date', 400);
    }

    const durationDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const currentYear = start.getFullYear();

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Verify leave type belongs to this tenant
      const ltRes = await client.query(
        'SELECT id, name FROM leave_types WHERE id = $1 AND organization_id = $2 AND is_active = true',
        [leave_type_id, tenantId]
      );
      if (ltRes.rows.length === 0) {
        throw new AppError('Invalid or inactive leave type for this organization', 404);
      }

      // 2. Fetch or initialize leave balance for this year
      let balanceRes = await client.query(
        `SELECT balance FROM leave_balances 
         WHERE person_id = $1 AND leave_type_id = $2 AND year = $3 FOR UPDATE`,
        [personId, leave_type_id, currentYear]
      );

      let currentBalance = 0;
      if (balanceRes.rows.length === 0) {
        // Initialize balance from leave policy if defined
        const policyRes = await client.query(
          'SELECT days_allowed FROM leave_policies WHERE leave_type_id = $1 LIMIT 1',
          [leave_type_id]
        );
        const initialAllowance = policyRes.rows.length > 0 ? parseFloat(policyRes.rows[0].days_allowed) : 0;

        const initRes = await client.query(
          `INSERT INTO leave_balances (person_id, leave_type_id, balance, year)
           VALUES ($1, $2, $3, $4)
           RETURNING balance`,
          [personId, leave_type_id, initialAllowance, currentYear]
        );
        currentBalance = parseFloat(initRes.rows[0].balance);
      } else {
        currentBalance = parseFloat(balanceRes.rows[0].balance);
      }

      // 3. Verify sufficient balance
      if (currentBalance < durationDays) {
        throw new AppError(
          `Insufficient leave balance for this request. Available: ${currentBalance}, Requested: ${durationDays}`,
          400
        );
      }

      // 4. Deduct balance tentatively for pending request
      const updatedBalance = currentBalance - durationDays;
      await client.query(
        `UPDATE leave_balances 
         SET balance = $1, updated_at = CURRENT_TIMESTAMP
         WHERE person_id = $2 AND leave_type_id = $3 AND year = $4`,
        [updatedBalance, personId, leave_type_id, currentYear]
      );

      // 5. Create leave request
      const result = await client.query(
        `INSERT INTO leave_requests (person_id, leave_type_id, start_date, end_date, reason, status)
         VALUES ($1, $2, $3, $4, $5, 'Pending')
         RETURNING id, person_id, leave_type_id, start_date, end_date, status, reason, created_at`,
        [personId, leave_type_id, start_date, end_date, reason || null]
      );

      const leaveRow = result.rows[0];

      // 6. Log audit trail
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'leave_request', $2, 'CREATE', $3::jsonb, $4, 'Leave request submitted')`,
        [
          tenantId,
          leaveRow.id,
          JSON.stringify({ ...leaveRow, duration_days: durationDays, remaining_balance: updatedBalance }),
          personId,
        ]
      );

      await client.query('COMMIT');

      return {
        ...leaveRow,
        duration_days: durationDays,
        remaining_balance: updatedBalance,
      };

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch own leaves and active balance breakdown.
   */
  async getMyLeaves(personId, year) {
    const targetYear = year || new Date().getFullYear();

    const requestsResult = await db.query(
      `SELECT lr.id, lr.start_date, lr.end_date, lr.status, lr.reason, lr.reviewer_remark, lr.created_at,
              lt.name AS leave_type_name
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.person_id = $1 
         AND EXTRACT(YEAR FROM lr.start_date) = $2
       ORDER BY lr.created_at DESC`,
      [personId, targetYear]
    );

    const balancesResult = await db.query(
      `SELECT lb.balance, lb.year, lt.id AS leave_type_id, lt.name AS leave_type_name, lt.is_paid
       FROM leave_balances lb
       JOIN leave_types lt ON lt.id = lb.leave_type_id
       WHERE lb.person_id = $1 AND lb.year = $2`,
      [personId, targetYear]
    );

    return {
      requests: requestsResult.rows,
      balances: balancesResult.rows,
    };
  }

  /**
   * Cancel own PENDING leave request and restore deducted balance.
   */
  async cancelMyLeave(personId, leaveId) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const existing = await client.query(
        'SELECT * FROM leave_requests WHERE id = $1 AND person_id = $2 FOR UPDATE',
        [leaveId, personId]
      );
      if (existing.rows.length === 0) throw new AppError('Leave request not found', 404);
      const leave = existing.rows[0];

      if (leave.status !== 'Pending') {
        throw new AppError('Only pending requests can be cancelled', 400);
      }

      const start = new Date(leave.start_date);
      const end = new Date(leave.end_date);
      const durationDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const leaveYear = start.getFullYear();

      // Restore balance
      await client.query(
        `UPDATE leave_balances
         SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP
         WHERE person_id = $2 AND leave_type_id = $3 AND year = $4`,
        [durationDays, personId, leave.leave_type_id, leaveYear]
      );

      const result = await client.query(
        `UPDATE leave_requests
         SET status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [personId, leaveId]
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
   * Fetch pending leave requests strictly for subordinate team members.
   */
  async getTeamPendingLeaves(managerPositionPath, tenantId, managerId) {
    if (!managerPositionPath) {
      throw new AppError('Manager position path is required', 400);
    }

    const result = await db.query(
      `SELECT 
         lr.id, lr.start_date, lr.end_date, lr.status, lr.reason, lr.created_at,
         lt.name AS leave_type_name,
         p.id AS person_id, p.first_name, p.last_name, p.email,
         pos.title AS position_title, pos.path AS position_path
       FROM leave_requests lr
       JOIN persons p ON p.id = lr.person_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       JOIN positions pos ON pos.id = pa.position_id
       WHERE p.organization_id = $1 
         AND lr.status = 'Pending'
         AND p.id <> $3
         AND pos.path <@ $2::ltree
         AND pos.path <> $2::ltree
       ORDER BY lr.created_at ASC`,
      [tenantId, managerPositionPath, managerId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      start_date: row.start_date,
      end_date: row.end_date,
      status: row.status,
      reason: row.reason,
      leave_type_name: row.leave_type_name,
      created_at: row.created_at,
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
    }));
  }

  /**
   * Action (Approve/Reject) a subordinate leave request.
   */
  async actionLeaveRequest(requestId, managerId, tenantId, action, remark = null) {
    if (!['Approved', 'Rejected'].includes(action)) {
      throw new AppError('Action must be either "Approved" or "Rejected"', 400);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const reqCheck = await client.query(
        `SELECT lr.*, p.organization_id 
         FROM leave_requests lr
         JOIN persons p ON p.id = lr.person_id
         WHERE lr.id = $1 FOR UPDATE`,
        [requestId]
      );

      if (reqCheck.rows.length === 0) {
        throw new AppError('Leave request not found', 404);
      }

      const leaveReq = reqCheck.rows[0];

      if (leaveReq.organization_id !== tenantId) {
        throw new AppError('Leave request does not belong to your organization', 403);
      }

      if (leaveReq.status !== 'Pending') {
        throw new AppError(`Cannot action a leave request that is already ${leaveReq.status}`, 400);
      }

      const start = new Date(leaveReq.start_date);
      const end = new Date(leaveReq.end_date);
      const durationDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const leaveYear = start.getFullYear();

      // If Rejected, restore deducted balance back to employee
      if (action === 'Rejected') {
        await client.query(
          `UPDATE leave_balances 
           SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP
           WHERE person_id = $2 AND leave_type_id = $3 AND year = $4`,
          [durationDays, leaveReq.person_id, leaveReq.leave_type_id, leaveYear]
        );
      }

      // Update leave request status
      const result = await client.query(
        `UPDATE leave_requests
         SET status = $1, reviewer_id = $2, reviewer_remark = $3, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING id, person_id, leave_type_id, start_date, end_date, status, reviewer_id, reviewer_remark, reviewed_at, updated_at`,
        [action, managerId, remark, requestId]
      );

      // Audit log
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
         VALUES ($1, 'leave_request', $2, 'UPDATE', $3::jsonb, $4::jsonb, $5, $6)`,
        [
          tenantId,
          requestId,
          JSON.stringify({ status: leaveReq.status }),
          JSON.stringify(result.rows[0]),
          managerId,
          `Leave request ${action.toLowerCase()} by manager`,
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
   * HR view — org-wide leaves (no 'reason' field exposed).
   */
  async getHRLeaves(tenantId, filters = {}) {
    const { status, from, to, leave_type_id, person_name } = filters;
    const params = [tenantId];
    const conditions = [`p.organization_id = $1`];

    if (status) {
      params.push(status);
      conditions.push(`lr.status = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`lr.start_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`lr.end_date <= $${params.length}`);
    }
    if (leave_type_id) {
      params.push(leave_type_id);
      conditions.push(`lr.leave_type_id = $${params.length}`);
    }
    if (person_name) {
      params.push(`%${person_name}%`);
      conditions.push(`(p.first_name ILIKE $${params.length} OR p.last_name ILIKE $${params.length})`);
    }

    const result = await db.query(
      `SELECT
         lr.id, lr.start_date, lr.end_date, lr.status, lr.created_at, lr.reviewed_at,
         lr.reviewer_remark,
         lt.name AS leave_type_name,
         p.id AS person_id, p.first_name, p.last_name, p.email, p.employee_id
       FROM leave_requests lr
       JOIN persons p ON p.id = lr.person_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY lr.created_at DESC`,
      params
    );
    return result.rows;
  }

  /**
   * Get all leave types for an org.
   */
  async getLeaveTypes(tenantId) {
    const result = await db.query(
      'SELECT id, name, is_paid, is_active FROM leave_types WHERE organization_id = $1 ORDER BY name ASC',
      [tenantId]
    );
    return result.rows;
  }
}
