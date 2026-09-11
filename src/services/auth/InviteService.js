import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../../db/index.js';
import { AppError } from '../../middlewares/errorHandler.js';

/**
 * InviteService — accept an activation invite token and set the employee's password.
 *
 * Token design
 * ────────────
 * Since migration 022, tokens are stored as SHA-256 hex digests in
 * org_invite_tokens.token_hash. The raw 64-hex-char token arrives from the
 * URL query parameter and is never stored anywhere.
 *
 * We verify the token in a single indexed lookup:
 *   WHERE token_hash = sha256(rawToken) AND used_at IS NULL AND expires_at > NOW()
 *   FOR UPDATE  ← prevents concurrent double-submission
 *
 * On success:
 *   • password_hash is set using bcrypt (12 rounds) — same library as before
 *   • activation_status is set to 'ACTIVE'
 *   • is_active is set to true
 *   • The token row is marked used_at = NOW()
 *   • Default 'Employee' role is assigned if not already present
 * All of the above runs inside a single BEGIN/COMMIT transaction.
 */

function sha256(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class InviteService {
  /**
   * Consume an activation token, set the user's password, and activate their account.
   *
   * @param {string} token  — raw token from URL query string
   * @param {string} password — chosen password (min 8 chars)
   */
  async acceptInvite(token, password) {
    if (!token || !password) {
      throw new AppError('Activation token and password are required', 400);
    }

    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters long', 400);
    }

    const tokenHash = sha256(token);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 1. Single indexed lookup with row-level lock — prevents concurrent activation
      const tokenResult = await client.query(
        `SELECT id, email, organization_id, expires_at
         FROM org_invite_tokens
         WHERE token_hash = $1
           AND used_at IS NULL
           AND expires_at > NOW()
         FOR UPDATE`,
        [tokenHash]
      );

      if (tokenResult.rows.length === 0) {
        throw new AppError('Invalid or expired invitation token', 400);
      }

      const { id: tokenId, email, organization_id: orgId } = tokenResult.rows[0];

      // 2. Find the person — lock the row too
      const personCheck = await client.query(
        `SELECT id, activation_status, is_active
         FROM persons
         WHERE organization_id = $1 AND email = $2
         FOR UPDATE`,
        [orgId, email]
      );

      if (personCheck.rows.length === 0) {
        throw new AppError('Associated employee account not found', 404);
      }

      const person = personCheck.rows[0];

      if (person.activation_status === 'ACTIVE') {
        throw new AppError('This account has already been activated. Please log in.', 400);
      }

      // 3. Hash the password chosen by the employee (bcrypt — same library as org admin passwords)
      const passwordHash = await bcrypt.hash(password, 12);

      // 4. Set password, mark ACTIVE, ensure is_active = true — all atomic
      await client.query(
        `UPDATE persons
         SET password_hash = $1,
             activation_status = 'ACTIVE',
             is_active = true,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [passwordHash, person.id]
      );

      // 5. Mark token as consumed
      await client.query(
        `UPDATE org_invite_tokens SET used_at = NOW() WHERE id = $1`,
        [tokenId]
      );

      // 6. Assign the default 'Employee' role if not already present
      let roleId;
      const employeeRoleCheck = await client.query(
        'SELECT id FROM roles WHERE organization_id = $1 AND name = $2',
        [orgId, 'Employee']
      );

      if (employeeRoleCheck.rows.length > 0) {
        roleId = employeeRoleCheck.rows[0].id;
      } else {
        const createRoleResult = await client.query(
          `INSERT INTO roles (organization_id, name) VALUES ($1, 'Employee') RETURNING id`,
          [orgId]
        );
        roleId = createRoleResult.rows[0].id;
      }

      const roleAssignCheck = await client.query(
        'SELECT id FROM person_roles WHERE person_id = $1 AND role_id = $2',
        [person.id, roleId]
      );

      if (roleAssignCheck.rows.length === 0) {
        await client.query(
          `INSERT INTO person_roles (person_id, role_id) VALUES ($1, $2)`,
          [person.id, roleId]
        );
      }

      // 7. Audit trail
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'person', $2, 'UPDATE', $3::jsonb, $4, 'Employee password set via activation link — account activated')`,
        [
          orgId,
          person.id,
          JSON.stringify({ activation_status: 'ACTIVE' }),
          person.id,
        ]
      );

      await client.query('COMMIT');

      return {
        message: 'Account activated successfully. You can now log in.',
        email,
      };

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
