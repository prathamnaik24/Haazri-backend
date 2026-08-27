import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

const VALID_RECORD_TYPES = ['SALARY', 'BONUS', 'DEDUCTION', 'PAYSLIP', 'OTHER'];

export class FinanceService {
  /**
   * Get all financial records for the org (CEO / Org Admin).
   */
  async getAllRecords(tenantId, filters = {}) {
    const { person_id, record_type, period_year, period_month } = filters;
    const params = [tenantId];
    const conditions = ['fr.organization_id = $1'];

    if (person_id) {
      params.push(person_id);
      conditions.push(`fr.person_id = $${params.length}`);
    }
    if (record_type) {
      params.push(record_type.toUpperCase());
      conditions.push(`fr.record_type = $${params.length}`);
    }
    if (period_year) {
      params.push(parseInt(period_year, 10));
      conditions.push(`fr.period_year = $${params.length}`);
    }
    if (period_month) {
      params.push(parseInt(period_month, 10));
      conditions.push(`fr.period_month = $${params.length}`);
    }

    const result = await db.query(
      `SELECT fr.*, p.first_name, p.last_name, p.email, p.employee_id
       FROM financial_records fr
       JOIN persons p ON p.id = fr.person_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY fr.period_year DESC, fr.period_month DESC, fr.created_at DESC`,
      params
    );
    return result.rows;
  }

  /**
   * Get financial records for a specific employee (CEO / Org Admin).
   */
  async getPersonRecords(tenantId, personId) {
    // Ensure person belongs to this org
    const personCheck = await db.query(
      'SELECT id FROM persons WHERE id = $1 AND organization_id = $2',
      [personId, tenantId]
    );
    if (personCheck.rows.length === 0) throw new AppError('Employee not found', 404);

    const result = await db.query(
      `SELECT * FROM financial_records
       WHERE organization_id = $1 AND person_id = $2
       ORDER BY period_year DESC, period_month DESC, created_at DESC`,
      [tenantId, personId]
    );
    return result.rows;
  }

  /**
   * Get own financial records (self-view for any role).
   */
  async getMyRecords(tenantId, personId, filters = {}) {
    const { record_type, period_year } = filters;
    const params = [tenantId, personId];
    const conditions = ['organization_id = $1', 'person_id = $2'];

    if (record_type) {
      params.push(record_type.toUpperCase());
      conditions.push(`record_type = $${params.length}`);
    }
    if (period_year) {
      params.push(parseInt(period_year, 10));
      conditions.push(`period_year = $${params.length}`);
    }

    const result = await db.query(
      `SELECT id, record_type, period_month, period_year, amount, currency, description, metadata, created_at
       FROM financial_records
       WHERE ${conditions.join(' AND ')}
       ORDER BY period_year DESC, period_month DESC, created_at DESC`,
      params
    );
    return result.rows;
  }

  /**
   * Create a financial record (Org Admin only).
   */
  async createRecord(tenantId, createdBy, body) {
    const { person_id, record_type, amount, period_month, period_year, currency, description, metadata } = body;

    if (!person_id || !record_type || amount === undefined) {
      throw new AppError('person_id, record_type, and amount are required', 400);
    }
    if (!VALID_RECORD_TYPES.includes(record_type.toUpperCase())) {
      throw new AppError(`record_type must be one of: ${VALID_RECORD_TYPES.join(', ')}`, 400);
    }
    if (typeof amount !== 'number' || amount < 0) {
      throw new AppError('amount must be a non-negative number', 400);
    }

    // Ensure employee belongs to org
    const personCheck = await db.query(
      'SELECT id FROM persons WHERE id = $1 AND organization_id = $2',
      [person_id, tenantId]
    );
    if (personCheck.rows.length === 0) throw new AppError('Employee not found in this organisation', 404);

    const result = await db.query(
      `INSERT INTO financial_records
         (organization_id, person_id, record_type, amount, period_month, period_year, currency, description, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       RETURNING *`,
      [
        tenantId, person_id, record_type.toUpperCase(), amount,
        period_month || null, period_year || null,
        currency || 'INR', description || null,
        JSON.stringify(metadata || {}), createdBy,
      ]
    );

    // Audit
    await db.query(
      `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
       VALUES ($1, 'financial_record', $2, 'CREATE', $3::jsonb, $4, 'Financial record created')`,
      [tenantId, result.rows[0].id, JSON.stringify(result.rows[0]), createdBy]
    );

    return result.rows[0];
  }

  /**
   * Update a financial record (Org Admin only).
   */
  async updateRecord(tenantId, recordId, updatedBy, body) {
    const existing = await db.query(
      'SELECT * FROM financial_records WHERE id = $1 AND organization_id = $2',
      [recordId, tenantId]
    );
    if (existing.rows.length === 0) throw new AppError('Financial record not found', 404);

    const old = existing.rows[0];
    const { amount, description, metadata, period_month, period_year } = body;

    const result = await db.query(
      `UPDATE financial_records
       SET amount       = COALESCE($1, amount),
           description  = COALESCE($2, description),
           metadata     = COALESCE($3::jsonb, metadata),
           period_month = COALESCE($4, period_month),
           period_year  = COALESCE($5, period_year),
           updated_at   = now()
       WHERE id = $6
       RETURNING *`,
      [amount ?? null, description ?? null, metadata ? JSON.stringify(metadata) : null,
       period_month ?? null, period_year ?? null, recordId]
    );

    await db.query(
      `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
       VALUES ($1, 'financial_record', $2, 'UPDATE', $3::jsonb, $4::jsonb, $5, 'Financial record updated')`,
      [tenantId, recordId, JSON.stringify(old), JSON.stringify(result.rows[0]), updatedBy]
    );

    return result.rows[0];
  }
}
