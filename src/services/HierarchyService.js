import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

export class HierarchyService {
  /**
   * Fetch complete organization hierarchy tree.
   * Scoped to the organization/tenant.
   * 
   * @param {string} orgId 
   * @returns {Promise<Array>} Nested tree of positions
   */
  static async getHierarchy(orgId) {
    const queryText = `
      SELECT 
        pos.id, 
        pos.parent_id, 
        pos.title, 
        pos.path::text AS path, 
        pos.is_active,
        pos.department_id,
        dept.name AS department_name,
        per.id AS person_id,
        per.first_name, 
        per.last_name,
        per.email
      FROM positions pos
      LEFT JOIN departments dept ON pos.department_id = dept.id
      LEFT JOIN position_assignments pa ON pos.id = pa.position_id 
        AND pa.is_primary = true 
        AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
      LEFT JOIN persons per ON pa.person_id = per.id AND per.is_active = true
      WHERE pos.organization_id = $1 AND pos.is_active = true
      ORDER BY pos.path
    `;
    const res = await db.query(queryText, [orgId]);
    const rows = res.rows;

    const map = {};
    const roots = [];

    // Initialize map
    for (const row of rows) {
      map[row.id] = {
        id: row.id,
        title: row.title,
        parent_id: row.parent_id,
        path: row.path,
        is_active: row.is_active,
        department: row.department_id ? {
          id: row.department_id,
          name: row.department_name
        } : null,
        employee: row.person_id ? {
          id: row.person_id,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email
        } : null,
        children: []
      };
    }

    // Build tree
    for (const row of rows) {
      const node = map[row.id];
      if (row.parent_id && map[row.parent_id]) {
        map[row.parent_id].children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Reorganize a node (move a position or move an employee)
   * 
   * @param {string} orgId 
   * @param {string} operatorPersonId 
   * @param {Object} data 
   * @param {string} data.type - 'position' or 'employee'
   * @param {string} [data.positionId] - ID of position to move (required for type='position')
   * @param {string} [data.employeeId] - ID of employee to move (required for type='employee')
   * @param {string} [data.targetParentPositionId] - Target parent position (for type='position')
   * @param {string} [data.targetDepartmentId] - Target department (for type='position')
   * @param {string} [data.targetPositionId] - Target position to assign the employee to (for type='employee')
   * @param {string} [data.reason] - Reason for reorganization
   */
  static async moveNode(orgId, operatorPersonId, data) {
    const { type, reason } = data;

    if (!type || (type !== 'position' && type !== 'employee')) {
      throw new AppError("Invalid move type. Must be 'position' or 'employee'", 400);
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      if (type === 'position') {
        const { positionId, targetParentPositionId, targetDepartmentId } = data;

        if (!positionId) {
          throw new AppError("positionId is required for moving a position", 400);
        }

        // 1. Fetch target position details
        const posRes = await client.query(
          'SELECT id, parent_id, path::text AS path, department_id, title FROM positions WHERE id = $1 AND organization_id = $2',
          [positionId, orgId]
        );
        if (posRes.rows.length === 0) {
          throw new AppError("Position not found in your organization", 404);
        }

        const oldParentId = posRes.rows[0].parent_id;
        const oldPath = posRes.rows[0].path;
        const oldDeptId = posRes.rows[0].department_id;
        const targetTitle = posRes.rows[0].title;

        const assignedEmployeeRes = await client.query(
          `SELECT pa.person_id AS employee_id,
                  dept.name AS department_name, parent_pos.title AS parent_title,
                  manager.id AS manager_person_id,
                  CASE WHEN manager.id IS NULL THEN NULL ELSE CONCAT(manager.first_name, ' ', manager.last_name) END AS manager_name
           FROM position_assignments pa
           JOIN positions pos ON pa.position_id = pos.id
           LEFT JOIN departments dept ON pos.department_id = dept.id
           LEFT JOIN positions parent_pos ON pos.parent_id = parent_pos.id
           LEFT JOIN position_assignments manager_assignment
             ON manager_assignment.position_id = pos.parent_id
            AND manager_assignment.is_primary = true
            AND (manager_assignment.end_date IS NULL OR manager_assignment.end_date >= CURRENT_DATE)
           LEFT JOIN persons manager ON manager_assignment.person_id = manager.id
           WHERE pa.position_id = $1 AND pa.is_primary = true
             AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
           LIMIT 1`,
          [positionId]
        );
        const assignedEmployee = assignedEmployeeRes.rows[0] || null;

        // Distinguish omitted parent (department-only) from explicit null (move to root).
        const parentSpecified = Object.prototype.hasOwnProperty.call(data, 'targetParentPositionId');

        // 2. Validate target parent position if a new parent was provided
        let newParentPath = null;
        if (parentSpecified && targetParentPositionId) {
          if (positionId === targetParentPositionId) {
            throw new AppError("A position cannot report to itself", 400);
          }

          const parentRes = await client.query(
            'SELECT id, path::text AS path, title FROM positions WHERE id = $1 AND organization_id = $2',
            [targetParentPositionId, orgId]
          );
          if (parentRes.rows.length === 0) {
            throw new AppError("Target parent position not found in your organization", 404);
          }

          newParentPath = parentRes.rows[0].path;

          // Prevent cyclic dependency: new parent path cannot start with old path
          if (newParentPath === oldPath || newParentPath.startsWith(oldPath + '.')) {
            throw new AppError("A position cannot report to its own descendant (circular reporting)", 400);
          }
        } else if (parentSpecified && targetParentPositionId !== null) {
          throw new AppError("Invalid targetParentPositionId", 400);
        }

        // 3. Validate target department if provided
        if (targetDepartmentId) {
          const deptRes = await client.query(
            'SELECT id FROM departments WHERE id = $1 AND organization_id = $2',
            [targetDepartmentId, orgId]
          );
          if (deptRes.rows.length === 0) {
            throw new AppError("Target department not found in your organization", 404);
          }
        }

        // 4. Update the path for the target position and all descendants
        //    Only when a parent change is explicitly requested. Department-only
        //    updates must not enter the move-to-root path.
        let newPath = oldPath;
        let resultingParentId = oldParentId;
        if (parentSpecified && targetParentPositionId) {
          const pathLabels = oldPath.split('.');
          const targetSlug = pathLabels[pathLabels.length - 1];
          newPath = `${newParentPath}.${targetSlug}`;
          resultingParentId = targetParentPositionId;

          await client.query(
            `UPDATE positions
             SET 
               parent_id = CASE WHEN id = $1 THEN $2::uuid ELSE parent_id END,
               path = CASE
                 WHEN path = $4::ltree THEN $3::ltree
                 ELSE ($3::ltree || subpath(path, nlevel($4::ltree)))
               END,
               updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $5 AND path <@ $4::ltree`,
            [positionId, targetParentPositionId, newPath, oldPath, orgId]
          );
        } else if (parentSpecified && targetParentPositionId === null) {
          // Explicit move to root
          const orgRes = await client.query('SELECT slug FROM organizations WHERE id = $1', [orgId]);
          const orgSlug = orgRes.rows[0].slug.replace(/-/g, '_');
          const pathLabels = oldPath.split('.');
          const targetSlug = pathLabels[pathLabels.length - 1];
          newPath = `${orgSlug}.${targetSlug}`;
          resultingParentId = null;

          await client.query(
            `UPDATE positions
             SET 
               parent_id = CASE WHEN id = $1 THEN NULL ELSE parent_id END,
               path = CASE
                 WHEN path = $3::ltree THEN $2::ltree
                 ELSE ($2::ltree || subpath(path, nlevel($3::ltree)))
               END,
               updated_at = CURRENT_TIMESTAMP
             WHERE organization_id = $4 AND path <@ $3::ltree`,
            [positionId, newPath, oldPath, orgId]
          );
        }

        // 5. Update department if specified
        if (targetDepartmentId !== undefined) {
          await client.query(
            'UPDATE positions SET department_id = $1 WHERE id = $2 AND organization_id = $3',
            [targetDepartmentId, positionId, orgId]
          );
        }

        // 6. Record in audit_logs
        await client.query(
          `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
           VALUES ($1, 'position', $2, 'MOVE', $3::jsonb, $4::jsonb, $5, $6)`,
          [
            orgId,
            positionId,
            JSON.stringify({
              parent_id: oldParentId,
              path: oldPath,
              department_id: oldDeptId,
              title: targetTitle
            }),
            JSON.stringify({
              parent_id: resultingParentId,
              path: newPath,
              department_id: targetDepartmentId !== undefined ? targetDepartmentId : oldDeptId,
              title: targetTitle
            }),
            operatorPersonId,
            reason || 'Position Hierarchy Reorganization'
          ]
        );

        if (assignedEmployee) {
          const currentEmployeeRes = await client.query(
            `SELECT pos.department_id, dept.name AS department_name, pos.parent_id,
                    parent_pos.title AS parent_title,
                    manager.id AS manager_person_id,
                    CASE WHEN manager.id IS NULL THEN NULL ELSE CONCAT(manager.first_name, ' ', manager.last_name) END AS manager_name
             FROM position_assignments pa
             JOIN positions pos ON pa.position_id = pos.id
             LEFT JOIN departments dept ON pos.department_id = dept.id
             LEFT JOIN positions parent_pos ON pos.parent_id = parent_pos.id
             LEFT JOIN position_assignments manager_assignment
               ON manager_assignment.position_id = pos.parent_id
              AND manager_assignment.is_primary = true
              AND (manager_assignment.end_date IS NULL OR manager_assignment.end_date >= CURRENT_DATE)
             LEFT JOIN persons manager ON manager_assignment.person_id = manager.id
             WHERE pa.person_id = $1 AND pa.position_id = $2 AND pa.is_primary = true
               AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
             LIMIT 1`,
            [assignedEmployee.employee_id, positionId]
          );
          const currentEmployee = currentEmployeeRes.rows[0];

          await client.query(
            `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
             VALUES ($1, 'employee_mobility', $2, 'MOVE', $3::jsonb, $4::jsonb, $5, $6)`,
            [
              orgId,
              assignedEmployee.employee_id,
              JSON.stringify({
                position_id: positionId,
                position_title: targetTitle,
                department_id: oldDeptId || null,
                department_name: assignedEmployee.department_name || null,
                parent_position_id: oldParentId || null,
                parent_position_title: assignedEmployee.parent_title || null,
                manager_person_id: assignedEmployee.manager_person_id || null,
                manager_name: assignedEmployee.manager_name || null
              }),
              JSON.stringify({
                position_id: positionId,
                position_title: targetTitle,
                department_id: currentEmployee?.department_id || null,
                department_name: currentEmployee?.department_name || null,
                parent_position_id: currentEmployee?.parent_id || null,
                parent_position_title: currentEmployee?.parent_title || null,
                manager_person_id: currentEmployee?.manager_person_id || null,
                manager_name: currentEmployee?.manager_name || null
              }),
              operatorPersonId,
              reason || 'Employee Internal Mobility'
            ]
          );
        }

        await client.query('COMMIT');
        return {
          success: true,
          type: 'position',
          positionId,
          newParentId: resultingParentId,
          newPath,
          newDepartmentId: targetDepartmentId !== undefined ? targetDepartmentId : oldDeptId
        };

      } else if (type === 'employee') {
        const { employeeId, targetPositionId } = data;

        if (!employeeId || !targetPositionId) {
          throw new AppError("employeeId and targetPositionId are required for moving an employee", 400);
        }

        // 1. Fetch employee details
        const empRes = await client.query(
          'SELECT id, first_name, last_name, email FROM persons WHERE id = $1 AND organization_id = $2',
          [employeeId, orgId]
        );
        if (empRes.rows.length === 0) {
          throw new AppError("Employee not found in your organization", 404);
        }

        // 2. Fetch target position details
        const newPosRes = await client.query(
          `SELECT pos.id, pos.title, pos.department_id, pos.parent_id,
                  dept.name AS department_name, parent_pos.title AS parent_title
           FROM positions pos
           LEFT JOIN departments dept ON pos.department_id = dept.id
           LEFT JOIN positions parent_pos ON pos.parent_id = parent_pos.id
           WHERE pos.id = $1 AND pos.organization_id = $2`,
          [targetPositionId, orgId]
        );
        if (newPosRes.rows.length === 0) {
          throw new AppError("Target position not found in your organization", 404);
        }

        // 3. Fetch current active assignment
        const activeAssignRes = await client.query(
          `SELECT pa.id AS assignment_id, pa.position_id, 
                  pos.title AS position_title, pos.department_id, pos.parent_id,
                  dept.name AS department_name, parent_pos.title AS parent_title
           FROM position_assignments pa
           JOIN positions pos ON pa.position_id = pos.id
           LEFT JOIN departments dept ON pos.department_id = dept.id
           LEFT JOIN positions parent_pos ON pos.parent_id = parent_pos.id
           WHERE pa.person_id = $1 AND pa.is_primary = true 
             AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
           LIMIT 1`,
          [employeeId]
        );

        // 4. Retrieve details of old manager (if any) and new manager (if any)
        let oldManager = null;
        if (activeAssignRes.rows.length > 0 && activeAssignRes.rows[0].parent_id) {
          const oldMgrRes = await client.query(
            `SELECT p.id, p.first_name, p.last_name FROM position_assignments pa
             JOIN persons p ON pa.person_id = p.id
             WHERE pa.position_id = $1 AND pa.is_primary = true 
               AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
             LIMIT 1`,
            [activeAssignRes.rows[0].parent_id]
          );
          if (oldMgrRes.rows.length > 0) {
            oldManager = oldMgrRes.rows[0];
          }
        }

        let newManager = null;
        if (newPosRes.rows[0].parent_id) {
          const newMgrRes = await client.query(
            `SELECT p.id, p.first_name, p.last_name FROM position_assignments pa
             JOIN persons p ON pa.person_id = p.id
             WHERE pa.position_id = $1 AND pa.is_primary = true 
               AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
             LIMIT 1`,
            [newPosRes.rows[0].parent_id]
          );
          if (newMgrRes.rows.length > 0) {
            newManager = newMgrRes.rows[0];
          }
        }

        // 5. Terminate old assignment
        if (activeAssignRes.rows.length > 0) {
          const assignmentId = activeAssignRes.rows[0].assignment_id;
          await client.query(
            'UPDATE position_assignments SET end_date = CURRENT_DATE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [assignmentId]
          );
        }

        // 6. Create new assignment
        await client.query(
          `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
           VALUES ($1, $2, true, CURRENT_DATE)`,
          [employeeId, targetPositionId]
        );

        // 7. Write to audit_logs
        const oldPos = activeAssignRes.rows[0] || null;
        const newPos = newPosRes.rows[0];

        await client.query(
          `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
           VALUES ($1, 'employee_mobility', $2, 'MOVE', $3::jsonb, $4::jsonb, $5, $6)`,
          [
            orgId,
            employeeId,
            JSON.stringify({
              position_id: oldPos?.position_id || null,
              position_title: oldPos?.position_title || null,
              department_id: oldPos?.department_id || null,
              department_name: oldPos?.department_name || null,
              parent_position_id: oldPos?.parent_id || null,
              parent_position_title: oldPos?.parent_title || null,
              manager_person_id: oldManager?.id || null,
              manager_name: oldManager ? `${oldManager.first_name} ${oldManager.last_name}` : null
            }),
            JSON.stringify({
              position_id: newPos.id,
              position_title: newPos.title,
              department_id: newPos.department_id || null,
              department_name: newPos.department_name || null,
              parent_position_id: newPos.parent_id || null,
              parent_position_title: newPos.parent_title || null,
              manager_person_id: newManager?.id || null,
              manager_name: newManager ? `${newManager.first_name} ${newManager.last_name}` : null
            }),
            operatorPersonId,
            reason || 'Employee Internal Mobility'
          ]
        );

        await client.query('COMMIT');
        return {
          success: true,
          type: 'employee',
          employeeId,
          newPositionId: targetPositionId,
          newPositionTitle: newPos.title
        };
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieve mobility history for an employee.
   * Scoped to the organization/tenant.
   * 
   * @param {string} orgId 
   * @param {string} employeeId 
   */
  static async getMobilityHistory(orgId, employeeId) {
    // Verify employee exists in organization first
    const empCheck = await db.query(
      'SELECT id FROM persons WHERE id = $1 AND organization_id = $2',
      [employeeId, orgId]
    );
    if (empCheck.rows.length === 0) {
      throw new AppError("Employee not found in your organization", 404);
    }

    const res = await db.query(
      `SELECT 
        al.id, al.action, al.old_data, al.new_data, al.reason, al.created_at,
        p.first_name AS actor_first_name, p.last_name AS actor_last_name
       FROM audit_logs al
       LEFT JOIN persons p ON al.changed_by = p.id
       WHERE al.organization_id = $1 
         AND al.entity_type = 'employee_mobility' 
         AND al.entity_id = $2
       ORDER BY al.created_at DESC`,
      [orgId, employeeId]
    );
    return res.rows;
  }
}
