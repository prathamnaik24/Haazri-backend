import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

export class LeaveService {
  /**
   * Submit a new leave request. Deducts the balance initially.
   */
  async requestLeave(personId, tenantId, data) {
    const { leave_type_id, start_date, end_date, reason = null } = data;

    if (!leave_type_id || !start_date || !end_date) {
      throw new AppError('leave_type_id, start_date, and end_date are required to submit a leave request', 400);
    }

    const start = new Date(start_date);
    const end = new Date(end_date);
    const year = start.getFullYear();

    // Check valid date range
    const diffMs = end.getTime() - start.getTime();
    if (diffMs < 0) {
      throw new AppError('End date must be on or after start date', 400);
    }

    const durationDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Verify leave type exists in this organization
      const typeCheck = await client.query(
        'SELECT id, name FROM leave_types WHERE id = $1 AND organization_id = $2 AND is_active = true',
        [leave_type_id, tenantId]
      );

      if (typeCheck.rows.length === 0) {
        throw new AppError('Leave type not found or is currently disabled', 404);
      }

      // 2. Resolve employee leave balance (initialize if missing)
      let balance = 0;
      const balanceCheck = await client.query(
        'SELECT id, balance FROM leave_balances WHERE person_id = $1 AND leave_type_id = $2 AND year = $3',
        [personId, leave_type_id, year]
      );

      if (balanceCheck.rows.length > 0) {
        balance = parseFloat(balanceCheck.rows[0].balance);
      } else {
        // No balance record — lookup policy to default configure it
        const policyCheck = await client.query(
          'SELECT days_allowed FROM leave_policies WHERE leave_type_id = $1',
          [leave_type_id]
        );

        const defaultAllowance = policyCheck.rows.length > 0 
          ? parseFloat(policyCheck.rows[0].days_allowed) 
          : 15.0; // Default fallback to 15 days if no policy defined

        const balanceInsert = await client.query(
          `INSERT INTO leave_balances (person_id, leave_type_id, balance, year)
           VALUES ($1, $2, $3, $4)
           RETURNING balance`,
          [personId, leave_type_id, defaultAllowance, year]
        );
        balance = parseFloat(balanceInsert.rows[0].balance);
      }

      // 3. Verify sufficient leave balance
      if (balance < durationDays) {
        throw new AppError(`Insufficient leave balance. Requested: ${durationDays} days, Available: ${balance} days`, 400);
      }

      // 4. Pre-deduct from balance
      await client.query(
        `UPDATE leave_balances 
         SET balance = balance - $1 
         WHERE person_id = $2 AND leave_type_id = $3 AND year = $4`,
        [durationDays, personId, leave_type_id, year]
      );

      // 5. Create leave request record
      const result = await client.query(
        `INSERT INTO leave_requests (person_id, leave_type_id, start_date, end_date, reason, status)
         VALUES ($1, $2, $3, $4, $5, 'Pending')
         RETURNING id, person_id, leave_type_id, start_date, end_date, status, reason`,
        [personId, leave_type_id, start_date, end_date, reason]
      );

      // 6. Log in audit logs
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'leave_request', $2, 'CREATE', $3::jsonb, $4, 'Leave request submitted')`,
        [
          tenantId,
          result.rows[0].id,
          JSON.stringify({ start_date, end_date, durationDays, leave_type_id }),
          personId,
        ]
      );

      await client.query('COMMIT');
      return {
        ...result.rows[0],
        duration_days: durationDays,
        remaining_balance: balance - durationDays,
      };

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch own leaves and active balances for the current year.
   */
  async getMyLeaves(personId, year = new Date().getFullYear()) {
    // 1. Fetch leave requests history
    const requests = await db.query(
      `SELECT lr.id, lr.start_date, lr.end_date, lr.status, lr.reason, lr.reviewer_id, lr.created_at,
              lt.name AS leave_type_name, lt.is_paid
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.person_id = $1
       ORDER BY lr.start_date DESC`,
      [personId]
    );

    // 2. Fetch leave balances for the year
    const balances = await db.query(
      `SELECT lb.balance, lb.year, lt.name AS leave_type_name, lt.id AS leave_type_id
       FROM leave_balances lb
       JOIN leave_types lt ON lt.id = lb.leave_type_id
       WHERE lb.person_id = $1 AND lb.year = $2`,
      [personId, year]
    );

    return {
      requests: requests.rows,
      balances: balances.rows,
      year,
    };
  }

  /**
   * Fetch pending leave requests from subordinate team members.
   */
  async getTeamPendingLeaves(managerPositionPath, tenantId, managerId) {
    if (!managerPositionPath) {
      throw new AppError('Manager position path context is required to query subordinate pending requests', 400);
    }

    const result = await db.query(
      `SELECT 
         lr.id, lr.start_date, lr.end_date, lr.status, lr.reason, lr.created_at,
         lt.name AS leave_type_name, lt.id AS leave_type_id,
         p.id AS person_id, p.first_name, p.last_name, p.email,
         pos.title AS position_title, pos.path AS position_path
       FROM leave_requests lr
       JOIN persons p ON p.id = lr.person_id
       JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       JOIN positions pos ON pos.id = pa.position_id
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE p.organization_id = $1 AND pos.path <@ $2::ltree AND lr.status = 'Pending' AND p.id <> $3
       ORDER BY lr.created_at ASC`,
      [tenantId, managerPositionPath, managerId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      start_date: row.start_date,
      end_date: row.end_date,
      status: row.status,
      reason: row.reason,
      created_at: row.created_at,
      leave_type: {
        id: row.leave_type_id,
        name: row.leave_type_name,
      },
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
   * Action a pending leave request (Approve or Reject).
   */
  async actionLeaveRequest(requestId, managerId, tenantId, action) {
    if (action !== 'Approved' && action !== 'Rejected') {
      throw new AppError('Action must be either "Approved" or "Rejected"', 400);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Fetch request details + verify active status
      const requestCheck = await client.query(
        `SELECT lr.id, lr.person_id, lr.leave_type_id, lr.start_date, lr.end_date, lr.status,
                p.organization_id
         FROM leave_requests lr
         JOIN persons p ON p.id = lr.person_id
         WHERE lr.id = $1`,
        [requestId]
      );

      if (requestCheck.rows.length === 0) {
        throw new AppError(`Leave request with ID "${requestId}" not found`, 404);
      }

      const leaveReq = requestCheck.rows[0];

      // 2. Validate tenant isolation
      if (leaveReq.organization_id !== tenantId) {
        throw new AppError('Unauthorized: Access denied to other organization request logs', 403);
      }

      // 3. Verify request is still pending review
      if (leaveReq.status !== 'Pending') {
        throw new AppError(`This leave request is already resolved and marked as "${leaveReq.status}"`, 400);
      }

      const start = new Date(leaveReq.start_date);
      const end = new Date(leaveReq.end_date);
      const year = start.getFullYear();
      const durationDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

      // 4. Process Action
      if (action === 'Approved') {
        // Leave is approved — keep the pre-deductions and mark resolved
        await client.query(
          `UPDATE leave_requests 
           SET status = 'Approved', reviewer_id = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [managerId, requestId]
        );
      } else {
        // Leave is rejected — mark resolved and revert the pre-deductions back to balance
        await client.query(
          `UPDATE leave_requests 
           SET status = 'Rejected', reviewer_id = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [managerId, requestId]
        );

        await client.query(
          `UPDATE leave_balances 
           SET balance = balance + $1
           WHERE person_id = $2 AND leave_type_id = $3 AND year = $4`,
          [durationDays, leaveReq.person_id, leaveReq.leave_type_id, year]
        );
      }

      // 5. Log in audit trail
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'leave_request', $2, 'UPDATE', $3::jsonb, $4, $5)`,
        [
          tenantId,
          requestId,
          JSON.stringify({ status: action, reviewer_id: managerId }),
          managerId,
          `Leave request review decision: ${action}`,
        ]
      );

      await client.query('COMMIT');

      // Fetch the updated request
      const updatedRes = await client.query(
        `SELECT lr.id, lr.start_date, lr.end_date, lr.status, lr.reason, lr.reviewer_id,
                lt.name AS leave_type_name
         FROM leave_requests lr
         JOIN leave_types lt ON lt.id = lr.leave_type_id
         WHERE lr.id = $1`,
        [requestId]
      );

      return updatedRes.rows[0];

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
