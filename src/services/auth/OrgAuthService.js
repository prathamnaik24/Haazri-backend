import bcrypt from 'bcryptjs';
import { db } from '../../db/index.js';
import { generateTokens } from '../../utils/token.js';
import { AppError } from '../../middlewares/errorHandler.js';

/**
 * OrgAuthService
 * Handles organization registration and admin login.
 *
 * An "organization admin" is the first person created when an org registers.
 * They get a special role ('Org Admin') that grants full access to their org.
 */
export class OrgAuthService {

  /**
   * Register a new organization and create its first admin user.
   * Runs as a single transaction — either everything succeeds or nothing is saved.
   *
   * @param {Object} data
   * @param {string} data.org_name
   * @param {string} data.org_slug - URL-friendly unique identifier for the org
   * @param {string} data.org_type - e.g., 'Corporate', 'School', 'NGO'
   * @param {string} data.admin_first_name
   * @param {string} data.admin_last_name
   * @param {string} data.admin_email
   * @param {string} data.admin_password
   */
  async register(data) {
    const {
      org_name,
      org_slug,
      org_type = 'Corporate',
      admin_first_name,
      admin_last_name,
      admin_email,
      admin_password,
    } = data;

    // Get a dedicated connection for the transaction
    const client = await db.getClient();

    try {
      await client.query('BEGIN');

      // 1. Check slug is not already taken
      const slugCheck = await client.query(
        'SELECT id FROM organizations WHERE slug = $1',
        [org_slug]
      );
      if (slugCheck.rows.length > 0) {
        throw new AppError(`Organization slug "${org_slug}" is already taken`, 409);
      }

      // 2. Create the organization
      const orgResult = await client.query(
        `INSERT INTO organizations (name, slug, type, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING id, name, slug, type`,
        [org_name, org_slug, org_type]
      );
      const organization = orgResult.rows[0];

      // 3. Hash the admin password
      const password_hash = await bcrypt.hash(admin_password, 12);

      // 4. Create the admin person
      const personResult = await client.query(
        `INSERT INTO persons (organization_id, first_name, last_name, email, password_hash, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id, first_name, last_name, email`,
        [organization.id, admin_first_name, admin_last_name, admin_email, password_hash]
      );
      const person = personResult.rows[0];

      // 5. Create a default "Org Admin" role for this organization
      const roleResult = await client.query(
        `INSERT INTO roles (organization_id, name)
         VALUES ($1, 'Org Admin')
         RETURNING id`,
        [organization.id]
      );
      const role = roleResult.rows[0];

      // 6. Assign that role to the admin person
      await client.query(
        `INSERT INTO person_roles (person_id, role_id)
         VALUES ($1, $2)`,
        [person.id, role.id]
      );

      // 7. Log the creation in audit_logs
      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
         VALUES ($1, 'organization', $2, 'CREATE',
                 $3::jsonb,
                 $4,
                 'Initial organization registration')`,
        [
          organization.id,
          organization.id,
          JSON.stringify({ name: org_name, slug: org_slug, type: org_type }),
          person.id,
        ]
      );

      await client.query('COMMIT');

      // 8. Generate JWT
      const tokens = generateTokens({
        person_id: person.id,
        organization_id: organization.id,
        first_name: person.first_name,
        last_name: person.last_name,
        email: person.email,
        type: 'org_admin',
        roles: ['Org Admin'],
      });

      return {
        organization,
        person: {
          id: person.id,
          first_name: person.first_name,
          last_name: person.last_name,
          email: person.email,
        },
        tokens,
      };

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Log in as an organization admin.
   * Requires org_slug to scope the lookup — after migration 009, email is only
   * unique per organization, so we must scope by org to find the right person.
   *
   * @param {Object} credentials
   * @param {string} credentials.org_slug
   * @param {string} credentials.email
   * @param {string} credentials.password
   */
  async login({ org_slug, email, password }) {
    // 1. Resolve the org by slug first
    const orgResult = await db.query(
      `SELECT id, name, slug, is_active FROM organizations WHERE slug = $1`,
      [org_slug]
    );

    if (orgResult.rows.length === 0) {
      throw new AppError('Invalid credentials', 401);
    }

    const org = orgResult.rows[0];

    if (!org.is_active) {
      throw new AppError('This organization account has been suspended.', 403);
    }

    // 2. Find the person by email scoped to this organization
    const result = await db.query(
      `SELECT
         p.id, p.first_name, p.last_name, p.email, p.password_hash,
         p.organization_id, p.is_active
       FROM persons p
       WHERE p.organization_id = $1 AND p.email = $2`,
      [org.id, email]
    );

    if (result.rows.length === 0) {
      throw new AppError('Invalid credentials', 401);
    }

    const person = result.rows[0];

    if (!person.is_active) {
      throw new AppError('Account is deactivated. Please contact your administrator.', 403);
    }

    // 3. Verify password
    const isValid = await bcrypt.compare(password, person.password_hash);
    if (!isValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // 4. Fetch their roles
    const rolesResult = await db.query(
      `SELECT r.name FROM person_roles pr
       JOIN roles r ON r.id = pr.role_id
       WHERE pr.person_id = $1`,
      [person.id]
    );
    const roles = rolesResult.rows.map((r) => r.name);

    // 5. Generate JWT
    const tokens = generateTokens({
      person_id: person.id,
      organization_id: person.organization_id,
      first_name: person.first_name,
      last_name: person.last_name,
      email: person.email,
      type: 'org_admin',
      roles,
    });

    return {
      person: {
        id: person.id,
        first_name: person.first_name,
        last_name: person.last_name,
        email: person.email,
        organization_id: person.organization_id,
        org_name: org.name,
        org_slug: org.slug,
      },
      roles,
      tokens,
    };
  }
}
