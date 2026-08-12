import bcrypt from 'bcryptjs';
import { db } from '../../db/index.js';
import { AppError } from '../../middlewares/errorHandler.js';

export class InviteService {
  /**
   * Consume an invite token, set the user's password, and activate their account.
   */
  async acceptInvite(token, password) {
    if (!token || !password) {
      throw new AppError('Invite token and password are required', 400);
    }

    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters long', 400);
    }

    // 1. Fetch all active, unexpired invite tokens
    const activeTokens = await db.query(
      `SELECT id, email, token_hash, organization_id, expires_at 
       FROM org_invite_tokens 
       WHERE used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`
    );

    let matchingTokenRow = null;

    // 2. Perform bcrypt comparison to locate the matching token
    for (const row of activeTokens.rows) {
      const isMatch = await bcrypt.compare(token, row.token_hash);
      if (isMatch) {
        matchingTokenRow = row;
        break;
      }
    }

    if (!matchingTokenRow) {
      throw new AppError('Invalid or expired invitation token', 400);
    }

    const { id: tokenId, email, organization_id: orgId } = matchingTokenRow;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // 3. Find the person matching this email & org
      const personCheck = await client.query(
        'SELECT id, is_active FROM persons WHERE organization_id = $1 AND email = $2',
        [orgId, email]
      );

      if (personCheck.rows.length === 0) {
        throw new AppError('Associated employee account not found', 404);
      }

      const person = personCheck.rows[0];

      // 4. Hash the password chosen by the employee
      const passwordHash = await bcrypt.hash(password, 12);

      // 5. Update password and ensure active status
      await client.query(
        `UPDATE persons 
         SET password_hash = $1, is_active = true, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [passwordHash, person.id]
      );

      // 6. Mark token as used
      await client.query(
        `UPDATE org_invite_tokens 
         SET used_at = CURRENT_TIMESTAMP 
         WHERE id = $1`,
        [tokenId]
      );

      // 7. Assign the default 'Employee' role if they don't already have one (create if it doesn't exist)
      let roleId;
      const employeeRoleCheck = await client.query(
        'SELECT id FROM roles WHERE organization_id = $1 AND name = $2',
        [orgId, 'Employee']
      );

      if (employeeRoleCheck.rows.length > 0) {
        roleId = employeeRoleCheck.rows[0].id;
      } else {
        const createRoleResult = await client.query(
          `INSERT INTO roles (organization_id, name)
           VALUES ($1, 'Employee')
           RETURNING id`,
          [orgId]
        );
        roleId = createRoleResult.rows[0].id;
      }

      // Ensure not already assigned
      const roleAssignCheck = await client.query(
        'SELECT id FROM person_roles WHERE person_id = $1 AND role_id = $2',
        [person.id, roleId]
      );

      if (roleAssignCheck.rows.length === 0) {
        await client.query(
          `INSERT INTO person_roles (person_id, role_id) 
           VALUES ($1, $2)`,
          [person.id, roleId]
        );
      }

      // 8. Log in audit trail
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'person', $2, 'UPDATE', $3::jsonb, $4, 'Employee password set and invitation consumed')`,
        [
          orgId,
          person.id,
          JSON.stringify({ status: 'activated' }),
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
