import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

export class OrgService {
  /**
   * Create an employee record and generate a registration invitation token.
   * Runs in a transaction to guarantee atomic persistence.
   */
  async createEmployee(tenantId, data, invitedBy) {
    const {
      first_name,
      last_name,
      email,
      phone_number = null,
      avatar_url = null,
      position_id = null,
    } = data;

    if (!first_name || !last_name || !email) {
      throw new AppError('First name, last name, and email are required to invite an employee', 400);
    }

    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 1. Check if email is already taken in this organization
      const emailCheck = await client.query(
        'SELECT id FROM persons WHERE organization_id = $1 AND email = $2',
        [tenantId, email.toLowerCase().trim()]
      );

      if (emailCheck.rows.length > 0) {
        throw new AppError(`Employee with email "${email}" already exists in this organization`, 409);
      }

      // 2. Generate a secure high-entropy placeholder password (persons.password_hash is NOT NULL)
      const placeholderPlain = crypto.randomBytes(32).toString('hex');
      const placeholderHash = await bcrypt.hash(placeholderPlain, 12);

      // 3. Create the person record
      const personResult = await client.query(
        `INSERT INTO persons (organization_id, first_name, last_name, email, password_hash, phone_number, avatar_url, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         RETURNING id, first_name, last_name, email, phone_number, avatar_url, is_active, joined_at`,
        [
          tenantId,
          first_name.trim(),
          last_name.trim(),
          email.toLowerCase().trim(),
          placeholderHash,
          phone_number ? phone_number.trim() : null,
          avatar_url ? avatar_url.trim() : null,
        ]
      );
      const employee = personResult.rows[0];

      // 4. Assign position if provided
      let primaryPosition = null;
      if (position_id) {
        // Validate position exists in this organization
        const posCheck = await client.query(
          'SELECT id, title, path FROM positions WHERE organization_id = $1 AND id = $2',
          [tenantId, position_id]
        );

        if (posCheck.rows.length === 0) {
          throw new AppError(`Position with ID "${position_id}" not found in this organization`, 404);
        }

        const assignmentResult = await client.query(
          `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
           VALUES ($1, $2, true, current_date)
           RETURNING id, position_id`,
          [employee.id, position_id]
        );

        primaryPosition = {
          id: posCheck.rows[0].id,
          title: posCheck.rows[0].title,
          path: posCheck.rows[0].path,
          assignment_id: assignmentResult.rows[0].id,
        };
      }

      // 5. Generate secure registration invitation token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = await bcrypt.hash(rawToken, 10);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry

      // Save token info
      await client.query(
        `INSERT INTO org_invite_tokens (organization_id, email, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [tenantId, employee.email, tokenHash, invitedBy, expiresAt]
      );

      // 6. Log in audit trail
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'person', $2, 'CREATE', $3::jsonb, $4, 'Employee registration invitation generated')`,
        [
          tenantId,
          employee.id,
          JSON.stringify({ first_name, last_name, email, position_id }),
          invitedBy,
        ]
      );

      await client.query('COMMIT');

      // We return the raw plain token for test/verification flows
      return {
        employee: {
          ...employee,
          primary_position: primaryPosition,
        },
        invite_token: rawToken,
        expires_at: expiresAt,
      };

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * List all employees in the organization (paginated).
   */
  async listEmployees(tenantId, options = {}) {
    const { limit = 20, offset = 0 } = options;

    const result = await db.query(
      `SELECT 
         p.id, p.first_name, p.last_name, p.email, p.phone_number, p.avatar_url, p.is_active, p.joined_at,
         pos.id AS position_id, pos.title AS position_title, pos.path AS position_path
       FROM persons p
       LEFT JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       LEFT JOIN positions pos ON pos.id = pa.position_id
       WHERE p.organization_id = $1
       ORDER BY p.last_name ASC, p.first_name ASC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(id) FROM persons WHERE organization_id = $1',
      [tenantId]
    );

    return {
      employees: result.rows.map((row) => ({
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        phone_number: row.phone_number,
        avatar_url: row.avatar_url,
        is_active: row.is_active,
        joined_at: row.joined_at,
        primary_position: row.position_id
          ? {
              id: row.position_id,
              title: row.position_title,
              path: row.position_path,
            }
          : null,
      })),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  /**
   * Get an employee by ID.
   */
  async getEmployeeById(tenantId, employeeId) {
    const result = await db.query(
      `SELECT 
         p.id, p.first_name, p.last_name, p.email, p.phone_number, p.avatar_url, p.is_active, p.joined_at,
         pos.id AS position_id, pos.title AS position_title, pos.path AS position_path
       FROM persons p
       LEFT JOIN position_assignments pa ON pa.person_id = p.id AND pa.is_primary = true AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       LEFT JOIN positions pos ON pos.id = pa.position_id
       WHERE p.organization_id = $1 AND p.id = $2`,
      [tenantId, employeeId]
    );

    if (result.rows.length === 0) {
      throw new AppError(`Employee not found with ID "${employeeId}"`, 404);
    }

    const row = result.rows[0];

    // Fetch employee roles
    const rolesResult = await db.query(
      `SELECT r.name FROM person_roles pr
       JOIN roles r ON r.id = pr.role_id
       WHERE pr.person_id = $1`,
      [row.id]
    );

    return {
      id: row.id,
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone_number: row.phone_number,
      avatar_url: row.avatar_url,
      is_active: row.is_active,
      joined_at: row.joined_at,
      primary_position: row.position_id
        ? {
            id: row.position_id,
            title: row.position_title,
            path: row.position_path,
          }
        : null,
      roles: rolesResult.rows.map((r) => r.name),
    };
  }
}
