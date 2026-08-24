import { db } from '../../db/index.js';
import { AppError } from '../../middlewares/errorHandler.js';

export class RoleService {
  /**
   * Fetch all roles for an organization, including their assigned permissions and employee counts.
   */
  static async getRoles(orgId) {
    const res = await db.query(`
      SELECT 
        r.id, 
        r.name, 
        r.created_at,
        COALESCE(
          json_agg(
            json_build_object('id', p.id, 'name', p.name, 'description', p.description)
          ) FILTER (WHERE p.id IS NOT NULL), 
          '[]'
        ) as permissions,
        (
          SELECT count(*)::int FROM person_roles pr WHERE pr.role_id = r.id
        ) as employee_count
      FROM roles r
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.id
      WHERE r.organization_id = $1
      GROUP BY r.id, r.name, r.created_at
      ORDER BY 
        CASE 
          WHEN r.name = 'Org Admin' THEN 1
          WHEN r.name = 'HR Manager' THEN 2
          WHEN r.name = 'Employee' THEN 3
          ELSE 4 
        END,
        r.name ASC
    `, [orgId]);
    return res.rows;
  }

  /**
   * Fetch all available system permissions.
   */
  static async getPermissions() {
    const res = await db.query(`
      SELECT id, name, description, created_at
      FROM permissions
      ORDER BY 
        CASE 
          WHEN name = 'manage_org' THEN 1
          WHEN name = 'manage_roles' THEN 2
          WHEN name = 'manage_employees' THEN 3
          WHEN name = 'view_attendance' THEN 4
          WHEN name = 'manage_attendance' THEN 5
          WHEN name = 'approve_leaves' THEN 6
          WHEN name = 'view_payroll' THEN 7
          ELSE 8 
        END,
        name ASC
    `);
    return res.rows;
  }

  /**
   * Create a new custom role for an organization with optional initial permissions.
   */
  static async createRole(orgId, { name, permissionIds = [] }) {
    if (!name || !name.trim()) {
      throw new AppError('Role name is required', 400);
    }

    const trimmedName = name.trim();

    // Check for duplicate role name in this organization
    const existing = await db.query(
      'SELECT id FROM roles WHERE organization_id = $1 AND LOWER(name) = LOWER($2)',
      [orgId, trimmedName]
    );
    if (existing.rows.length > 0) {
      throw new AppError(`Role "${trimmedName}" already exists in this organization`, 409);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const roleRes = await client.query(
        `INSERT INTO roles (organization_id, name)
         VALUES ($1, $2)
         RETURNING id, name, created_at`,
        [orgId, trimmedName]
      );
      const newRole = roleRes.rows[0];

      if (Array.isArray(permissionIds) && permissionIds.length > 0) {
        for (const pId of permissionIds) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [newRole.id, pId]
          );
        }
      }

      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, reason)
         VALUES ($1, 'role', $2, 'CREATE', $3::jsonb, 'New role created with custom permissions')`,
        [orgId, newRole.id, JSON.stringify({ name: trimmedName, permissionIds })]
      );

      await client.query('COMMIT');
      return newRole;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Rename an existing role.
   */
  static async updateRole(orgId, roleId, { name }) {
    if (!name || !name.trim()) {
      throw new AppError('Role name is required', 400);
    }

    const trimmedName = name.trim();

    const roleCheck = await db.query(
      'SELECT id, name FROM roles WHERE id = $1 AND organization_id = $2',
      [roleId, orgId]
    );
    if (roleCheck.rows.length === 0) {
      throw new AppError('Role not found', 404);
    }

    const res = await db.query(
      `UPDATE roles SET name = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND organization_id = $3
       RETURNING id, name, updated_at`,
      [trimmedName, roleId, orgId]
    );

    return res.rows[0];
  }

  /**
   * Delete a custom role.
   */
  static async deleteRole(orgId, roleId) {
    const roleRes = await db.query(
      'SELECT id, name FROM roles WHERE id = $1 AND organization_id = $2',
      [roleId, orgId]
    );
    if (roleRes.rows.length === 0) {
      throw new AppError('Role not found', 404);
    }

    const roleName = roleRes.rows[0].name;
    if (roleName === 'Org Admin') {
      throw new AppError('The "Org Admin" primary system role cannot be deleted.', 400);
    }

    const employeeCountRes = await db.query(
      'SELECT COUNT(*)::int FROM person_roles WHERE role_id = $1',
      [roleId]
    );
    const employeeCount = employeeCountRes.rows[0].count;
    if (employeeCount > 0) {
      throw new AppError(
        `Cannot delete role "${roleName}" because ${employeeCount} employee(s) are currently assigned to it. Please reassign their roles first.`,
        409
      );
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      await client.query('DELETE FROM roles WHERE id = $1', [roleId]);

      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, reason)
         VALUES ($1, 'role', $2, 'DELETE', $3::jsonb, 'Role deleted')`,
        [orgId, roleId, JSON.stringify({ name: roleName })]
      );

      await client.query('COMMIT');
      return { success: true, message: `Role "${roleName}" deleted successfully` };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Assign or update permissions for a role in real-time.
   */
  static async assignPermissions(orgId, roleId, permissionIds) {
    const roleCheck = await db.query(
      'SELECT id, name FROM roles WHERE id = $1 AND organization_id = $2',
      [roleId, orgId]
    );
    if (roleCheck.rows.length === 0) {
      throw new AppError('Role not found in this organization', 404);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

      if (Array.isArray(permissionIds) && permissionIds.length > 0) {
        for (const pId of permissionIds) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ($1, $2)`,
            [roleId, pId]
          );
        }
      }

      await client.query(
        `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, reason)
         VALUES ($1, 'role_permissions', $2, 'UPDATE', $3::jsonb, 'Updated role permissions matrix')`,
        [orgId, roleId, JSON.stringify({ roleId, permissionIds })]
      );

      await client.query('COMMIT');
      return { success: true, roleId, permissionIds };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
