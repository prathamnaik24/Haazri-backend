import bcrypt from 'bcryptjs';
import { db } from '../../db/index.js';
import { generateTokens } from '../../utils/token.js';
import { AppError } from '../../middlewares/errorHandler.js';

/**
 * EmployeeAuthService
 * Handles standard employee login.
 *
 * Employees log in with their organization's slug + their email + password.
 * The org_slug scopes the login to the correct tenant, preventing cross-org
 * credential collisions (two orgs can have employees with the same email).
 *
 * On success, the JWT payload includes the employee's primary position's ltree
 * path, which is used by the backend to resolve management hierarchy queries.
 */
export class EmployeeAuthService {

  /**
   * @param {Object} credentials
   * @param {string} credentials.org_slug  - The organization's unique slug
   * @param {string} credentials.email
   * @param {string} credentials.password
   */
  async login({ org_slug, email, password }) {
    // 1. Resolve org by slug
    const orgResult = await db.query(
      `SELECT id, name, slug, is_active FROM organizations WHERE slug = $1`,
      [org_slug]
    );

    if (orgResult.rows.length === 0) {
      // Return generic message — don't reveal whether the org exists
      throw new AppError('Invalid credentials', 401);
    }

    const org = orgResult.rows[0];

    if (!org.is_active) {
      throw new AppError('This organization account has been suspended.', 403);
    }

    // 2. Find the person by email within this specific organization
    //    (email + org_id is the composite unique key after migration 009)
    const personResult = await db.query(
      `SELECT
         p.id, p.first_name, p.last_name, p.email,
         p.password_hash, p.is_active, p.organization_id
       FROM persons p
       WHERE p.organization_id = $1 AND p.email = $2`,
      [org.id, email]
    );

    if (personResult.rows.length === 0) {
      throw new AppError('Invalid credentials', 401);
    }

    const person = personResult.rows[0];

    if (!person.is_active) {
      throw new AppError('Your account has been deactivated. Please contact HR.', 403);
    }

    // 3. Verify password
    const isValid = await bcrypt.compare(password, person.password_hash);
    if (!isValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // 4. Fetch their primary position assignment + the position's ltree path
    //    The ltree path is what enables the "manager sees all subordinates" feature
    const positionResult = await db.query(
      `SELECT
         pa.id AS assignment_id,
         pa.position_id,
         pos.title AS position_title,
         pos.path AS position_path
       FROM position_assignments pa
       JOIN positions pos ON pos.id = pa.position_id
       WHERE pa.person_id = $1
         AND pa.is_primary = true
         AND (pa.end_date IS NULL OR pa.end_date >= current_date)
       LIMIT 1`,
      [person.id]
    );

    const primaryPosition = positionResult.rows[0] || null;

    // 5. Fetch their roles
    const rolesResult = await db.query(
      `SELECT r.name FROM person_roles pr
       JOIN roles r ON r.id = pr.role_id
       WHERE pr.person_id = $1`,
      [person.id]
    );
    const roles = rolesResult.rows.map((r) => r.name);

    // 6. Generate JWT with full context
    const tokens = generateTokens({
      person_id: person.id,
      organization_id: person.organization_id,
      type: 'employee',
      position_path: primaryPosition?.position_path ?? null,
      roles,
    });

    return {
      person: {
        id: person.id,
        first_name: person.first_name,
        last_name: person.last_name,
        email: person.email,
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
        },
        primary_position: primaryPosition
          ? {
              id: primaryPosition.position_id,
              title: primaryPosition.position_title,
              path: primaryPosition.position_path,
            }
          : null,
      },
      roles,
      tokens,
    };
  }
}
