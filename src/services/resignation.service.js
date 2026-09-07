import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

export const RESIGNATION_STATUSES = {
  PENDING_MANAGER_REVIEW: 'PENDING_MANAGER_REVIEW',
  MANAGER_APPROVED: 'MANAGER_APPROVED',
  HR_REVIEW: 'HR_REVIEW',
  APPROVED: 'APPROVED',
  NOTICE_PERIOD: 'NOTICE_PERIOD',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
};

// Explicit valid state transitions
const VALID_TRANSITIONS = {
  [RESIGNATION_STATUSES.PENDING_MANAGER_REVIEW]: [
    RESIGNATION_STATUSES.MANAGER_APPROVED,
    RESIGNATION_STATUSES.HR_REVIEW,
    RESIGNATION_STATUSES.REJECTED,
  ],
  [RESIGNATION_STATUSES.MANAGER_APPROVED]: [
    RESIGNATION_STATUSES.HR_REVIEW,
    RESIGNATION_STATUSES.APPROVED,
    RESIGNATION_STATUSES.NOTICE_PERIOD,
  ],
  [RESIGNATION_STATUSES.HR_REVIEW]: [
    RESIGNATION_STATUSES.APPROVED,
    RESIGNATION_STATUSES.NOTICE_PERIOD,
    RESIGNATION_STATUSES.REJECTED,
  ],
  [RESIGNATION_STATUSES.APPROVED]: [
    RESIGNATION_STATUSES.NOTICE_PERIOD,
    RESIGNATION_STATUSES.COMPLETED,
  ],
  [RESIGNATION_STATUSES.NOTICE_PERIOD]: [
    RESIGNATION_STATUSES.COMPLETED,
  ],
  [RESIGNATION_STATUSES.COMPLETED]: [],
  [RESIGNATION_STATUSES.REJECTED]: [],
};

const MAX_COMMENT_LENGTH = 2000;

export class ResignationService {
  /**
   * Validate if a status transition is permitted
   */
  static validateTransition(currentStatus, newStatus) {
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      throw new AppError(`Invalid status transition from '${currentStatus}' to '${newStatus}'`, 400);
    }
  }

  /**
   * Submit a resignation request for the authenticated employee
   */
  static async submitResignation(personId, tenantId, body) {
    const { proposed_last_working_day, reason, comments } = body;

    if (!proposed_last_working_day) {
      throw new AppError('Proposed last working day is required', 400);
    }
    if (!reason || !reason.trim()) {
      throw new AppError('Reason for resignation is required', 400);
    }
    if (reason.trim().length > MAX_COMMENT_LENGTH) {
      throw new AppError(`Reason must not exceed ${MAX_COMMENT_LENGTH} characters`, 400);
    }
    if (comments && comments.trim().length > MAX_COMMENT_LENGTH) {
      throw new AppError(`Comments must not exceed ${MAX_COMMENT_LENGTH} characters`, 400);
    }

    const proposedDate = new Date(proposed_last_working_day);
    if (isNaN(proposedDate.getTime())) {
      throw new AppError('Invalid proposed last working day date format', 400);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Verify employee exists and is active/eligible in organization
      const empRes = await client.query(
        `SELECT id, first_name, last_name, email, employment_status 
         FROM persons 
         WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [personId, tenantId]
      );
      if (empRes.rows.length === 0) {
        throw new AppError('Employee not found in your organization', 404);
      }

      const emp = empRes.rows[0];
      if (emp.employment_status === 'RESIGNED') {
        throw new AppError('Employee is already marked as RESIGNED and cannot submit a new resignation', 400);
      }

      // 2. Prevent duplicate active resignations
      const activeRes = await client.query(
        `SELECT id, status FROM resignations 
         WHERE person_id = $1 
           AND status IN ('PENDING_MANAGER_REVIEW', 'MANAGER_APPROVED', 'HR_REVIEW', 'APPROVED', 'NOTICE_PERIOD')
         LIMIT 1`,
        [personId]
      );
      if (activeRes.rows.length > 0) {
        throw new AppError('An active resignation request already exists for this employee.', 400);
      }

      // 3. Create resignation record
      const insertRes = await client.query(
        `INSERT INTO resignations (
           organization_id, person_id, submission_date, proposed_last_working_day, reason, comments, status
         ) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6)
         RETURNING *`,
        [tenantId, personId, proposed_last_working_day, reason.trim(), comments?.trim() || null, RESIGNATION_STATUSES.PENDING_MANAGER_REVIEW]
      );
      const resignation = insertRes.rows[0];

      // 4. Log audit event (actor derived strictly from authenticated personId)
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'resignation', $2, 'SUBMIT', $3::jsonb, $4, $5)`,
        [
          tenantId,
          resignation.id,
          JSON.stringify(resignation),
          personId,
          'Resignation submitted by employee',
        ]
      );

      await client.query('COMMIT');
      return resignation;
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505' && err.constraint === 'resignations_single_active_per_person') {
        throw new AppError('An active resignation request already exists for this employee.', 400);
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch own resignation history and current active request
   */
  static async getOwnResignations(personId, tenantId) {
    const res = await db.query(
      `SELECT r.*, 
              m.first_name AS manager_first_name, m.last_name AS manager_last_name,
              hr.first_name AS hr_first_name, hr.last_name AS hr_last_name
       FROM resignations r
       LEFT JOIN persons m ON r.manager_id = m.id
       LEFT JOIN persons hr ON r.hr_id = hr.id
       WHERE r.person_id = $1 AND r.organization_id = $2
       ORDER BY r.created_at DESC`,
      [personId, tenantId]
    );
    return res.rows;
  }

  /**
   * Fetch resignation requests belonging to authorized manager's direct reports
   */
  static async getManagerResignations(managerPersonId, tenantId, userRoles = []) {
    const isOrgAdmin = userRoles.includes('Org Admin') || userRoles.includes('HR Manager');

    let queryText = '';
    let params = [];

    if (isOrgAdmin) {
      queryText = `
        SELECT r.*, 
               p.first_name, p.last_name, p.email, p.employee_id,
               pos.title AS position_title,
               m.first_name AS manager_first_name, m.last_name AS manager_last_name
        FROM resignations r
        JOIN persons p ON r.person_id = p.id
        LEFT JOIN position_assignments pa ON p.id = pa.person_id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
        LEFT JOIN positions pos ON pa.position_id = pos.id
        LEFT JOIN persons m ON r.manager_id = m.id
        WHERE r.organization_id = $1
        ORDER BY r.created_at DESC
      `;
      params = [tenantId];
    } else {
      queryText = `
        SELECT r.*, 
               p.first_name, p.last_name, p.email, p.employee_id,
               pos.title AS position_title,
               m.first_name AS manager_first_name, m.last_name AS manager_last_name
        FROM resignations r
        JOIN persons p ON r.person_id = p.id
        JOIN position_assignments pa ON p.id = pa.person_id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
        JOIN positions pos ON pa.position_id = pos.id
        JOIN position_assignments mgr_pa ON pos.parent_id = mgr_pa.position_id AND mgr_pa.is_primary = true AND (mgr_pa.end_date IS NULL OR mgr_pa.end_date >= CURRENT_DATE)
        LEFT JOIN persons m ON r.manager_id = m.id
        WHERE r.organization_id = $1 AND mgr_pa.person_id = $2
        ORDER BY r.created_at DESC
      `;
      params = [tenantId, managerPersonId];
    }

    const res = await db.query(queryText, params);
    return res.rows;
  }

  /**
   * Manager action (Approve or Reject)
   */
  static async actionManagerReview(resignationId, managerPersonId, tenantId, body, userRoles = []) {
    const { action, comment } = body;
    if (!['APPROVE', 'REJECT'].includes(action)) {
      throw new AppError("Action must be 'APPROVE' or 'REJECT'", 400);
    }
    if (action === 'REJECT' && (!comment || !comment.trim())) {
      throw new AppError('Rejection reason is required when rejecting a resignation', 400);
    }
    if (comment && comment.trim().length > MAX_COMMENT_LENGTH) {
      throw new AppError(`Comment must not exceed ${MAX_COMMENT_LENGTH} characters`, 400);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const resQuery = await client.query(
        `SELECT r.*, p.organization_id 
         FROM resignations r
         JOIN persons p ON r.person_id = p.id
         WHERE r.id = $1 FOR UPDATE`,
        [resignationId]
      );
      if (resQuery.rows.length === 0) {
        throw new AppError('Resignation request not found', 404);
      }

      const resignation = resQuery.rows[0];
      if (resignation.organization_id !== tenantId) {
        throw new AppError('Resignation request does not belong to your organization', 403);
      }

      // Security check: An employee cannot review/approve their own resignation request
      if (resignation.person_id === managerPersonId) {
        throw new AppError('Employees cannot review or approve their own resignation request', 403);
      }

      if (resignation.status !== RESIGNATION_STATUSES.PENDING_MANAGER_REVIEW) {
        throw new AppError(`Cannot perform manager review on a resignation with status '${resignation.status}'`, 400);
      }

      // Check manager authorization if not Org Admin / HR Manager
      const isOrgAdmin = userRoles.includes('Org Admin') || userRoles.includes('HR Manager');
      if (!isOrgAdmin) {
        const mgrAuth = await client.query(
          `SELECT 1 FROM position_assignments sub_pa
           JOIN positions sub_pos ON sub_pa.position_id = sub_pos.id
           JOIN position_assignments mgr_pa ON sub_pos.parent_id = mgr_pa.position_id 
             AND mgr_pa.is_primary = true AND (mgr_pa.end_date IS NULL OR mgr_pa.end_date >= CURRENT_DATE)
           WHERE sub_pa.person_id = $1 AND mgr_pa.person_id = $2
             AND sub_pa.is_primary = true AND (sub_pa.end_date IS NULL OR sub_pa.end_date >= CURRENT_DATE)`,
          [resignation.person_id, managerPersonId]
        );
        if (mgrAuth.rows.length === 0) {
          throw new AppError('You are not authorized to review this employee resignation request', 403);
        }
      }

      let nextStatus = RESIGNATION_STATUSES.HR_REVIEW;
      if (action === 'REJECT') {
        nextStatus = RESIGNATION_STATUSES.REJECTED;
      }

      this.validateTransition(resignation.status, nextStatus);

      const updateRes = await client.query(
        `UPDATE resignations
         SET status = $1,
             manager_id = $2,
             manager_reviewed_at = CURRENT_TIMESTAMP,
             manager_comment = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
        [nextStatus, managerPersonId, comment?.trim() || null, resignationId]
      );
      const updated = updateRes.rows[0];

      // Audit log (actor derived strictly from managerPersonId)
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
         VALUES ($1, 'resignation', $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [
          tenantId,
          resignationId,
          action === 'APPROVE' ? 'MANAGER_APPROVE' : 'MANAGER_REJECT',
          JSON.stringify({ status: resignation.status }),
          JSON.stringify(updated),
          managerPersonId,
          comment?.trim() || `Manager ${action.toLowerCase()}d resignation`,
        ]
      );

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Fetch all resignations for HR review
   */
  static async getHRResignations(tenantId, filters = {}) {
    const { status } = filters;
    const params = [tenantId];
    const conditions = ['r.organization_id = $1'];

    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    const res = await db.query(
      `SELECT r.*, 
              p.first_name, p.last_name, p.email, p.employee_id, p.employment_status,
              pos.title AS position_title,
              m.first_name AS manager_first_name, m.last_name AS manager_last_name,
              hr.first_name AS hr_first_name, hr.last_name AS hr_last_name
       FROM resignations r
       JOIN persons p ON r.person_id = p.id
       LEFT JOIN position_assignments pa ON p.id = pa.person_id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
       LEFT JOIN positions pos ON pa.position_id = pos.id
       LEFT JOIN persons m ON r.manager_id = m.id
       LEFT JOIN persons hr ON r.hr_id = hr.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.created_at DESC`,
      params
    );
    return res.rows;
  }

  /**
   * HR action (Approve and transition to NOTICE_PERIOD)
   */
  static async actionHRReview(resignationId, hrPersonId, tenantId, body) {
    const { approved_last_working_day, comment } = body;

    if (approved_last_working_day) {
      const approvedDate = new Date(approved_last_working_day);
      if (isNaN(approvedDate.getTime())) {
        throw new AppError('Invalid approved last working day date format', 400);
      }
    }

    if (comment && comment.trim().length > MAX_COMMENT_LENGTH) {
      throw new AppError(`Comment must not exceed ${MAX_COMMENT_LENGTH} characters`, 400);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const resQuery = await client.query(
        `SELECT r.* FROM resignations r WHERE r.id = $1 AND r.organization_id = $2 FOR UPDATE`,
        [resignationId, tenantId]
      );
      if (resQuery.rows.length === 0) {
        throw new AppError('Resignation request not found', 404);
      }

      const resignation = resQuery.rows[0];
      if (![RESIGNATION_STATUSES.HR_REVIEW, RESIGNATION_STATUSES.MANAGER_APPROVED].includes(resignation.status)) {
        throw new AppError(`Cannot perform HR approval on resignation with status '${resignation.status}'`, 400);
      }

      const nextStatus = RESIGNATION_STATUSES.NOTICE_PERIOD;
      this.validateTransition(resignation.status, nextStatus);

      const finalLastWorkingDay = approved_last_working_day || resignation.proposed_last_working_day;

      const updateRes = await client.query(
        `UPDATE resignations
         SET status = $1,
             approved_last_working_day = $2,
             hr_id = $3,
             hr_reviewed_at = CURRENT_TIMESTAMP,
             hr_comment = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [nextStatus, finalLastWorkingDay, hrPersonId, comment?.trim() || null, resignationId]
      );
      const updated = updateRes.rows[0];

      // Audit log (actor derived strictly from hrPersonId)
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
         VALUES ($1, 'resignation', $2, 'HR_APPROVE', $3::jsonb, $4::jsonb, $5, $6)`,
        [
          tenantId,
          resignationId,
          JSON.stringify({ status: resignation.status }),
          JSON.stringify(updated),
          hrPersonId,
          comment?.trim() || 'HR approved resignation and started notice period',
        ]
      );

      await client.query('COMMIT');
      return updated;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Complete Resignation (Mark as Resigned)
   * Transactional operation:
   * 1. Resignation status -> COMPLETED
   * 2. Employee employment_status -> RESIGNED
   * 3. End employee position assignment (position record itself remains unchanged)
   * 4. Audit log recorded
   */
  static async completeResignation(resignationId, hrPersonId, tenantId, body = {}) {
    const { comment } = body;

    if (comment && comment.trim().length > MAX_COMMENT_LENGTH) {
      throw new AppError(`Comment must not exceed ${MAX_COMMENT_LENGTH} characters`, 400);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const resQuery = await client.query(
        `SELECT r.* FROM resignations r WHERE r.id = $1 AND r.organization_id = $2 FOR UPDATE`,
        [resignationId, tenantId]
      );
      if (resQuery.rows.length === 0) {
        throw new AppError('Resignation request not found', 404);
      }

      const resignation = resQuery.rows[0];
      if (resignation.status === RESIGNATION_STATUSES.COMPLETED) {
        throw new AppError('Resignation request is already completed', 400);
      }

      if (![RESIGNATION_STATUSES.NOTICE_PERIOD, RESIGNATION_STATUSES.APPROVED].includes(resignation.status)) {
        throw new AppError(`Cannot complete resignation with status '${resignation.status}'`, 400);
      }

      const empRes = await client.query(
        `SELECT id, employment_status FROM persons WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [resignation.person_id, tenantId]
      );
      if (empRes.rows.length === 0) {
        throw new AppError('Employee not found in organization', 404);
      }
      if (empRes.rows[0].employment_status === 'RESIGNED') {
        throw new AppError('Employee is already marked as RESIGNED', 400);
      }

      const nextStatus = RESIGNATION_STATUSES.COMPLETED;
      this.validateTransition(resignation.status, nextStatus);

      // 1. Update resignation status
      const updateRes = await client.query(
        `UPDATE resignations
         SET status = $1,
             completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [nextStatus, resignationId]
      );
      const updatedResignation = updateRes.rows[0];

      // 2. Update employee employment_status to RESIGNED
      await client.query(
        `UPDATE persons
         SET employment_status = 'RESIGNED',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND organization_id = $2`,
        [resignation.person_id, tenantId]
      );

      // 3. Terminate active position assignment WITHOUT touching or duplicating position records
      await client.query(
        `UPDATE position_assignments
         SET end_date = CURRENT_DATE,
             updated_at = CURRENT_TIMESTAMP
         WHERE person_id = $1 AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
        [resignation.person_id]
      );

      // 4. Record audit entry (actor derived strictly from hrPersonId)
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
         VALUES ($1, 'resignation', $2, 'COMPLETE', $3::jsonb, $4::jsonb, $5, $6)`,
        [
          tenantId,
          resignationId,
          JSON.stringify({ status: resignation.status, employment_status: 'ACTIVE' }),
          JSON.stringify({ status: RESIGNATION_STATUSES.COMPLETED, employment_status: 'RESIGNED', completed_at: updatedResignation.completed_at }),
          hrPersonId,
          comment?.trim() || 'Resignation completed. Employee employment status updated to RESIGNED.',
        ]
      );

      await client.query('COMMIT');
      return updatedResignation;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get detail for a single resignation by ID with IDOR protection
   */
  static async getResignationById(resignationId, tenantId, requestingPersonId, userRoles = []) {
    const res = await db.query(
      `SELECT r.*, 
              p.first_name, p.last_name, p.email, p.employee_id, p.employment_status,
              pos.title AS position_title,
              m.first_name AS manager_first_name, m.last_name AS manager_last_name,
              hr.first_name AS hr_first_name, hr.last_name AS hr_last_name
       FROM resignations r
       JOIN persons p ON r.person_id = p.id
       LEFT JOIN position_assignments pa ON p.id = pa.person_id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
       LEFT JOIN positions pos ON pa.position_id = pos.id
       LEFT JOIN persons m ON r.manager_id = m.id
       LEFT JOIN persons hr ON r.hr_id = hr.id
       WHERE r.id = $1 AND r.organization_id = $2`,
      [resignationId, tenantId]
    );

    if (res.rows.length === 0) {
      throw new AppError('Resignation request not found', 404);
    }

    const resignation = res.rows[0];
    const isOwner = resignation.person_id === requestingPersonId;
    const isOrgAdmin = userRoles.includes('Org Admin') || userRoles.includes('HR Manager');

    if (!isOwner && !isOrgAdmin) {
      // Check if requesting user is the employee's authorized reporting manager
      const mgrAuth = await db.query(
        `SELECT 1 FROM position_assignments sub_pa
         JOIN positions sub_pos ON sub_pa.position_id = sub_pos.id
         JOIN position_assignments mgr_pa ON sub_pos.parent_id = mgr_pa.position_id 
           AND mgr_pa.is_primary = true AND (mgr_pa.end_date IS NULL OR mgr_pa.end_date >= CURRENT_DATE)
         WHERE sub_pa.person_id = $1 AND mgr_pa.person_id = $2
           AND sub_pa.is_primary = true AND (sub_pa.end_date IS NULL OR sub_pa.end_date >= CURRENT_DATE)`,
        [resignation.person_id, requestingPersonId]
      );
      if (mgrAuth.rows.length === 0) {
        throw new AppError('You are not authorized to view this resignation request', 403);
      }
    }

    return resignation;
  }
}
