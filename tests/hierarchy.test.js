import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../src/app.js';
import { db } from '../src/db/index.js';
import { closePool } from '../src/config/db.js';

const RUN_ID = Date.now();

// Tenant A Configuration
const ORG_A = {
  org_name: `Tenant A Corp ${RUN_ID}`,
  org_slug: `tenant-a-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Admin',
  admin_last_name: 'A',
  admin_email: `admin-a-${RUN_ID}@tenanta.com`,
  admin_password: 'TestPass@123A',
};

// Tenant B Configuration
const ORG_B = {
  org_name: `Tenant B Corp ${RUN_ID}`,
  org_slug: `tenant-b-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Admin',
  admin_last_name: 'B',
  admin_email: `admin-b-${RUN_ID}@tenantb.com`,
  admin_password: 'TestPass@123B',
};

let adminTokenA = '';
let adminPersonAId = '';
let orgAId = '';

let employeeTokenA = '';
let employeePersonAId = '';

let adminTokenB = '';
let orgBId = '';

let positionCeoA = '';
let positionCtoA = '';
let positionDevA = '';
let departmentEngA = '';
let departmentSalesA = '';

let positionAnalystA = '';
let positionAnalystJrA = '';
let analystPathBefore = '';
let analystJrPathBefore = '';

let positionHeadOpsA = '';
let positionOpsLeadA = '';
let opsLeadPathBefore = '';

let positionVpProductA = '';
let positionMgrAA = '';
let positionMgrBA = '';
let positionIcCA = '';
let positionVpEngA = '';

let hrManagerTokenA = '';
let hrManagerPersonAId = '';
let hrManagerUnauthTokenB = '';
let positionTenantB = '';
let orgBSlugForLtree = '';

afterAll(async () => {
  await closePool();
});

describe('Feature #1 Integration Tests — Organizational Structure & Hierarchy', () => {

  beforeAll(async () => {
    // 1. Register Tenant A and Tenant B
    const resA = await request(app).post('/api/auth/org/register').send(ORG_A);
    expect(resA.status).toBe(201);
    adminTokenA = resA.body.data.tokens.accessToken;
    adminPersonAId = resA.body.data.person.id;
    orgAId = resA.body.data.organization.id;

    const resB = await request(app).post('/api/auth/org/register').send(ORG_B);
    expect(resB.status).toBe(201);
    adminTokenB = resB.body.data.tokens.accessToken;
    orgBId = resB.body.data.organization.id;

    // 2. Set up Departments and Positions in Tenant A directly using DB queries to construct a clear hierarchy
    // Create Department: Engineering
    const deptRes = await db.query(
      `INSERT INTO departments (organization_id, name, is_active)
       VALUES ($1, 'Engineering', true) RETURNING id`,
      [orgAId]
    );
    departmentEngA = deptRes.rows[0].id;

    const salesRes = await db.query(
      `INSERT INTO departments (organization_id, name, is_active)
       VALUES ($1, 'Sales', true) RETURNING id`,
      [orgAId]
    );
    departmentSalesA = salesRes.rows[0].id;

    // Create Root Position: CEO
    const ceoSlug = 'ceo';
    const ceoPath = `${ORG_A.org_slug.replace(/-/g, '_')}.${ceoSlug}`;
    const ceoRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, NULL, 'CEO', $3::ltree, true) RETURNING id`,
      [orgAId, departmentEngA, ceoPath]
    );
    positionCeoA = ceoRes.rows[0].id;

    // Create Sub-position: CTO (reports to CEO)
    const ctoSlug = 'cto';
    const ctoPath = `${ceoPath}.${ctoSlug}`;
    const ctoRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'CTO', $4::ltree, true) RETURNING id`,
      [orgAId, departmentEngA, positionCeoA, ctoPath]
    );
    positionCtoA = ctoRes.rows[0].id;

    // Create Sub-sub-position: Senior Developer (reports to CTO)
    const devSlug = 'sr_dev';
    const devPath = `${ctoPath}.${devSlug}`;
    const devRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'Senior Developer', $4::ltree, true) RETURNING id`,
      [orgAId, departmentEngA, positionCtoA, devPath]
    );
    positionDevA = devRes.rows[0].id;

    // Link Admin A to CEO Position
    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, CURRENT_DATE)`,
      [adminPersonAId, positionCeoA]
    );

    // 3. Create a Test Employee in Tenant A
    const empEmail = `emp-a-${RUN_ID}@tenanta.com`;
    const empPass = 'EmployeePass@123';
    const empHash = await bcrypt.hash(empPass, 12);

    const empRes = await db.query(
      `INSERT INTO persons (organization_id, first_name, last_name, email, password_hash, is_active, employee_id)
       VALUES ($1, 'Rohan', 'Employee', $2, $3, true, 'EMP-HIER-001') RETURNING id`,
      [orgAId, empEmail, empHash]
    );
    employeePersonAId = empRes.rows[0].id;

    // Assign Role: Employee
    let employeeRoleId;
    const roleRes = await db.query("SELECT id FROM roles WHERE organization_id = $1 AND name = 'Employee'", [orgAId]);
    if (roleRes.rows.length > 0) {
      employeeRoleId = roleRes.rows[0].id;
    } else {
      const insertRole = await db.query(
        "INSERT INTO roles (organization_id, name) VALUES ($1, 'Employee') RETURNING id",
        [orgAId]
      );
      employeeRoleId = insertRole.rows[0].id;
    }

    // Map view_hierarchy permission to the Employee role
    const permRes = await db.query("SELECT id FROM permissions WHERE name = 'view_hierarchy'");
    if (permRes.rows.length > 0) {
      await db.query(
        "INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [employeeRoleId, permRes.rows[0].id]
      );
    }

    await db.query('INSERT INTO person_roles (person_id, role_id) VALUES ($1, $2)', [employeePersonAId, employeeRoleId]);

    // Assign Employee A to CTO Position
    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, CURRENT_DATE)`,
      [employeePersonAId, positionCtoA]
    );

    // 4. Log in Employee A to get token
    const loginRes = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: ORG_A.org_slug,
        email: empEmail,
        password: empPass
      });
    expect(loginRes.status).toBe(200);
    employeeTokenA = loginRes.body.data.tokens.accessToken;

    // Dedicated fixture: Analyst (under CEO) with a junior descendant — department-only tests
    const analystPath = `${ceoPath}.analyst`;
    const analystRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'Analyst', $4::ltree, true) RETURNING id, path::text AS path`,
      [orgAId, departmentEngA, positionCeoA, analystPath]
    );
    positionAnalystA = analystRes.rows[0].id;
    analystPathBefore = analystRes.rows[0].path;

    const analystJrPath = `${analystPath}.analyst_jr`;
    const analystJrRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'Junior Analyst', $4::ltree, true) RETURNING id, path::text AS path`,
      [orgAId, departmentEngA, positionAnalystA, analystJrPath]
    );
    positionAnalystJrA = analystJrRes.rows[0].id;
    analystJrPathBefore = analystJrRes.rows[0].path;

    // Dedicated fixture: Head of Ops (under CEO) with Ops Lead child — move-to-root tests
    const headOpsPath = `${ceoPath}.head_ops`;
    const headOpsRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'Head of Ops', $4::ltree, true) RETURNING id`,
      [orgAId, departmentEngA, positionCeoA, headOpsPath]
    );
    positionHeadOpsA = headOpsRes.rows[0].id;

    const opsLeadPath = `${headOpsPath}.ops_lead`;
    const opsLeadRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'Ops Lead', $4::ltree, true) RETURNING id, path::text AS path`,
      [orgAId, departmentEngA, positionHeadOpsA, opsLeadPath]
    );
    positionOpsLeadA = opsLeadRes.rows[0].id;
    opsLeadPathBefore = opsLeadRes.rows[0].path;

    // Dedicated fixture: multi-level subtree
    // CEO -> VP Product -> Manager A -> Manager B -> IC C
    // CEO -> VP Engineering (target parent for Manager A)
    const vpProductPath = `${ceoPath}.vp_product`;
    const vpProductRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'VP Product', $4::ltree, true) RETURNING id`,
      [orgAId, departmentEngA, positionCeoA, vpProductPath]
    );
    positionVpProductA = vpProductRes.rows[0].id;

    const mgrAPath = `${vpProductPath}.mgr_a`;
    const mgrARes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'Manager A', $4::ltree, true) RETURNING id`,
      [orgAId, departmentEngA, positionVpProductA, mgrAPath]
    );
    positionMgrAA = mgrARes.rows[0].id;

    const mgrBPath = `${mgrAPath}.mgr_b`;
    const mgrBRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'Manager B', $4::ltree, true) RETURNING id`,
      [orgAId, departmentEngA, positionMgrAA, mgrBPath]
    );
    positionMgrBA = mgrBRes.rows[0].id;

    const icCPath = `${mgrBPath}.ic_c`;
    const icCRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'IC C', $4::ltree, true) RETURNING id`,
      [orgAId, departmentEngA, positionMgrBA, icCPath]
    );
    positionIcCA = icCRes.rows[0].id;

    const vpEngPath = `${ceoPath}.vp_eng`;
    const vpEngRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'VP Engineering', $4::ltree, true) RETURNING id`,
      [orgAId, departmentEngA, positionCeoA, vpEngPath]
    );
    positionVpEngA = vpEngRes.rows[0].id;

    // Authorized HR Manager in Tenant A (migration 012 maps manage_hierarchy to HR Manager)
    const hrEmail = `hr-a-${RUN_ID}@tenanta.com`;
    const hrPass = 'HrManagerPass@123';
    const hrHash = await bcrypt.hash(hrPass, 12);
    const hrPersonRes = await db.query(
      `INSERT INTO persons (organization_id, first_name, last_name, email, password_hash, is_active, employee_id)
       VALUES ($1, 'Priya', 'HR', $2, $3, true, 'EMP-HR-001') RETURNING id`,
      [orgAId, hrEmail, hrHash]
    );
    hrManagerPersonAId = hrPersonRes.rows[0].id;

    const hrRoleRes = await db.query(
      `INSERT INTO roles (organization_id, name) VALUES ($1, 'HR Manager') RETURNING id`,
      [orgAId]
    );
    const hrRoleId = hrRoleRes.rows[0].id;

    const managePerm = await db.query("SELECT id FROM permissions WHERE name = 'manage_hierarchy'");
    const viewPerm = await db.query("SELECT id FROM permissions WHERE name = 'view_hierarchy'");
    expect(managePerm.rows.length).toBe(1);
    expect(viewPerm.rows.length).toBe(1);

    await db.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2), ($1, $3)',
      [hrRoleId, managePerm.rows[0].id, viewPerm.rows[0].id]
    );
    await db.query('INSERT INTO person_roles (person_id, role_id) VALUES ($1, $2)', [hrManagerPersonAId, hrRoleId]);

    const hrLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({ org_slug: ORG_A.org_slug, email: hrEmail, password: hrPass });
    expect(hrLogin.status).toBe(200);
    hrManagerTokenA = hrLogin.body.data.tokens.accessToken;

    // Unauthorized HR Manager in Tenant B: role name is HR Manager, but manage_hierarchy is not mapped
    orgBSlugForLtree = ORG_B.org_slug.replace(/-/g, '_');
    const deptBRes = await db.query(
      `INSERT INTO departments (organization_id, name, is_active) VALUES ($1, 'Operations', true) RETURNING id`,
      [orgBId]
    );
    const ceoBPath = `${orgBSlugForLtree}.ceo`;
    const ceoBRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, NULL, 'CEO', $3::ltree, true) RETURNING id`,
      [orgBId, deptBRes.rows[0].id, ceoBPath]
    );
    const staffBPath = `${ceoBPath}.staff`;
    const staffBRes = await db.query(
      `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
       VALUES ($1, $2, $3, 'Staff', $4::ltree, true) RETURNING id`,
      [orgBId, deptBRes.rows[0].id, ceoBRes.rows[0].id, staffBPath]
    );
    positionTenantB = staffBRes.rows[0].id;

    const hrBEmail = `hr-b-${RUN_ID}@tenantb.com`;
    const hrBPass = 'HrManagerPass@123B';
    const hrBHash = await bcrypt.hash(hrBPass, 12);
    const hrBPersonRes = await db.query(
      `INSERT INTO persons (organization_id, first_name, last_name, email, password_hash, is_active, employee_id)
       VALUES ($1, 'Sam', 'HRB', $2, $3, true, 'EMP-HR-B-001') RETURNING id`,
      [orgBId, hrBEmail, hrBHash]
    );
    const hrBRoleRes = await db.query(
      `INSERT INTO roles (organization_id, name) VALUES ($1, 'HR Manager') RETURNING id`,
      [orgBId]
    );
    // Only view_hierarchy — simulates HR Manager without manage_hierarchy mapping
    await db.query(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)',
      [hrBRoleRes.rows[0].id, viewPerm.rows[0].id]
    );
    await db.query(
      'INSERT INTO person_roles (person_id, role_id) VALUES ($1, $2)',
      [hrBPersonRes.rows[0].id, hrBRoleRes.rows[0].id]
    );

    const hrBLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({ org_slug: ORG_B.org_slug, email: hrBEmail, password: hrBPass });
    expect(hrBLogin.status).toBe(200);
    hrManagerUnauthTokenB = hrBLogin.body.data.tokens.accessToken;
  });

  describe('1. Organization Chart Visibility (READ ACCESS)', () => {

    it('should allow Employee A to retrieve organization hierarchy', async () => {
      const res = await request(app)
        .get('/api/org/hierarchy')
        .set('Authorization', `Bearer ${employeeTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);

      // Verify roots structure contains CEO
      const ceoNode = res.body.data.find(n => n.id === positionCeoA);
      expect(ceoNode).toBeDefined();
      expect(ceoNode.title).toBe('CEO');
      expect(ceoNode.children.length).toBeGreaterThan(0);

      // Verify children contains CTO
      const ctoNode = ceoNode.children.find(n => n.id === positionCtoA);
      expect(ctoNode).toBeDefined();
      expect(ctoNode.title).toBe('CTO');
      expect(ctoNode.employee.id).toBe(employeePersonAId);
    });

    it('should block Employee A from performing hierarchy mutations (read-only enforcement)', async () => {
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${employeeTokenA}`)
        .send({
          type: 'position',
          positionId: positionDevA,
          targetParentPositionId: positionCeoA
        });

      // Employee role lacks manage_hierarchy permission
      expect(res.status).toBe(403);
    });

    it('should block unauthenticated requests to get hierarchy', async () => {
      const res = await request(app).get('/api/org/hierarchy');
      expect(res.status).toBe(401);
    });
  });

  describe('2. Admin/Authorized User Reorganization (MUTATION ACCESS)', () => {

    it('should allow Admin A to reorganize hierarchy (moving Senior Dev to report to CEO directly)', async () => {
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'position',
          positionId: positionDevA,
          targetParentPositionId: positionCeoA,
          reason: 'Promoted reporting line'
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.newParentId).toBe(positionCeoA);

      // Verify the new path updated in database (Senior Dev should now report to CEO)
      const pathRes = await db.query('SELECT path::text, parent_id FROM positions WHERE id = $1', [positionDevA]);
      expect(pathRes.rows[0].parent_id).toBe(positionCeoA);
      expect(pathRes.rows[0].path).toMatch(/\.sr_dev$/);
      expect(pathRes.rows[0].path.split('.').length).toBe(3); // org_slug.ceo.sr_dev
    });

    it('should allow Admin A to move an employee to another position', async () => {
      // Move Employee A to Senior Dev position
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'employee',
          employeeId: employeePersonAId,
          targetPositionId: positionDevA,
          reason: 'Transferred to Sr Dev'
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.success).toBe(true);

      // Verify assignment was ended and new one was created
      const activeAssign = await db.query(
        'SELECT position_id FROM position_assignments WHERE person_id = $1 AND is_primary = true AND end_date IS NULL',
        [employeePersonAId]
      );
      expect(activeAssign.rows.length).toBe(1);
      expect(activeAssign.rows[0].position_id).toBe(positionDevA);
    });

    it('should reject unauthorized role from reorganizing hierarchy', async () => {
      // Employee A does not have manage_hierarchy permission
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${employeeTokenA}`)
        .send({
          type: 'position',
          positionId: positionDevA,
          targetParentPositionId: positionCeoA
        });

      expect(res.status).toBe(403);
    });
  });

  describe('3. Multi-Tenancy & Isolation', () => {

    it('should reject Admin B from viewing Tenant A\'s hierarchy', async () => {
      // Admin B requests hierarchy. Since it is scoped to Tenant B, it will return Tenant B's hierarchy
      // and Admin B won't see Tenant A's position nodes (e.g. positionCeoA).
      const res = await request(app)
        .get('/api/org/hierarchy')
        .set('Authorization', `Bearer ${adminTokenB}`);

      expect(res.status).toBe(200);
      const foundCeoA = res.body.data.find(n => n.id === positionCeoA);
      expect(foundCeoA).toBeUndefined();
    });

    it('should reject Admin B from moving Tenant A\'s employees or positions', async () => {
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenB}`)
        .send({
          type: 'position',
          positionId: positionDevA,
          targetParentPositionId: positionCeoA
        });

      expect(res.status).toBe(404); // Position is not found under Tenant B
    });
  });

  describe('4. Hierarchy Integrity Checks', () => {

    it('should reject moving a position to report to itself', async () => {
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'position',
          positionId: positionDevA,
          targetParentPositionId: positionDevA
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/cannot report to itself/i);
    });

    it('should reject moving a position to report to its own descendant (circular reporting)', async () => {
      // Currently CEO (positionCeoA) reports to NULL, and Senior Dev (positionDevA) reports to CEO.
      // If we try to make CEO report to Senior Dev, it should be rejected.
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'position',
          positionId: positionCeoA,
          targetParentPositionId: positionDevA
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/circular reporting/i);
    });
  });

  describe('5. Internal Mobility & History Tracking', () => {

    it('should retain a complete history of employee movements in audit logs', async () => {
      const res = await request(app)
        .get(`/api/org/hierarchy/mobility/${employeePersonAId}`)
        .set('Authorization', `Bearer ${adminTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.length).toBeGreaterThan(0);

      // Verify the details in the mobility log entry
      const logEntry = res.body.data[0];
      expect(logEntry.action).toBe('MOVE');
      expect(logEntry.old_data.position_id).toBe(positionCtoA);
      expect(logEntry.new_data.position_id).toBe(positionDevA);
      expect(logEntry.reason).toBe('Transferred to Sr Dev');
      expect(logEntry.actor_first_name).toBe('Admin');
    });
  });

  describe('6. Transactional Safety Checks', () => {

    it('should rollback all changes if any part of the move operation fails', async () => {
      // Attempting to move employee to a non-existent position, which will fail.
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'employee',
          employeeId: employeePersonAId,
          targetPositionId: '00000000-0000-0000-0000-000000000000'
        });

      expect(res.status).toBe(404);

      // Verify employee assignment remains untouched (still primary on positionDevA)
      const currentAssign = await db.query(
        'SELECT position_id FROM position_assignments WHERE person_id = $1 AND is_primary = true AND end_date IS NULL',
        [employeePersonAId]
      );
      expect(currentAssign.rows[0].position_id).toBe(positionDevA);
    });
  });

  describe('7. Department-only change (must not move to root)', () => {

    it('should update department while keeping parent and hierarchy path unchanged', async () => {
      const before = await db.query(
        'SELECT parent_id, path::text AS path, department_id FROM positions WHERE id = $1',
        [positionAnalystA]
      );
      expect(before.rows[0].parent_id).toBe(positionCeoA);
      expect(before.rows[0].department_id).toBe(departmentEngA);

      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'position',
          positionId: positionAnalystA,
          targetDepartmentId: departmentSalesA,
          reason: 'Department reassignment only'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.newDepartmentId).toBe(departmentSalesA);
      expect(res.body.data.newParentId).toBe(positionCeoA);
      expect(res.body.data.newPath).toBe(analystPathBefore);

      const after = await db.query(
        'SELECT parent_id, path::text AS path, department_id FROM positions WHERE id = $1',
        [positionAnalystA]
      );
      expect(after.rows[0].department_id).toBe(departmentSalesA);
      expect(after.rows[0].parent_id).toBe(positionCeoA);
      expect(after.rows[0].path).toBe(analystPathBefore);

      const childAfter = await db.query(
        'SELECT parent_id, path::text AS path FROM positions WHERE id = $1',
        [positionAnalystJrA]
      );
      expect(childAfter.rows[0].parent_id).toBe(positionAnalystA);
      expect(childAfter.rows[0].path).toBe(analystJrPathBefore);
    });

    it('should record audit history without rewriting parent as root', async () => {
      const audit = await db.query(
        `SELECT old_data, new_data, reason FROM audit_logs
         WHERE organization_id = $1 AND entity_type = 'position' AND entity_id = $2 AND action = 'MOVE'
         ORDER BY created_at DESC LIMIT 1`,
        [orgAId, positionAnalystA]
      );
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].reason).toBe('Department reassignment only');
      expect(audit.rows[0].old_data.department_id).toBe(departmentEngA);
      expect(audit.rows[0].new_data.department_id).toBe(departmentSalesA);
      expect(audit.rows[0].old_data.parent_id).toBe(positionCeoA);
      expect(audit.rows[0].new_data.parent_id).toBe(positionCeoA);
      expect(audit.rows[0].new_data.path).toBe(analystPathBefore);
    });
  });

  describe('8. Explicit move-to-root', () => {

    it('should move a node to root when targetParentPositionId is explicitly null', async () => {
      const orgSlugLtree = ORG_A.org_slug.replace(/-/g, '_');

      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'position',
          positionId: positionHeadOpsA,
          targetParentPositionId: null,
          reason: 'Promote Head of Ops to root'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.newParentId).toBeNull();
      expect(res.body.data.newPath).toBe(`${orgSlugLtree}.head_ops`);

      const moved = await db.query(
        'SELECT parent_id, path::text AS path FROM positions WHERE id = $1',
        [positionHeadOpsA]
      );
      expect(moved.rows[0].parent_id).toBeNull();
      expect(moved.rows[0].path).toBe(`${orgSlugLtree}.head_ops`);
    });

    it('should keep descendant parent links and repath the subtree under the new root path', async () => {
      const orgSlugLtree = ORG_A.org_slug.replace(/-/g, '_');
      const descendant = await db.query(
        'SELECT parent_id, path::text AS path FROM positions WHERE id = $1',
        [positionOpsLeadA]
      );
      expect(descendant.rows[0].parent_id).toBe(positionHeadOpsA);
      expect(descendant.rows[0].path).toBe(`${orgSlugLtree}.head_ops.ops_lead`);
      expect(descendant.rows[0].path).not.toBe(opsLeadPathBefore);
      expect(descendant.rows[0].path.startsWith(`${orgSlugLtree}.head_ops.`)).toBe(true);
    });

    it('should record move-to-root in audit_logs', async () => {
      const audit = await db.query(
        `SELECT old_data, new_data, changed_by, reason FROM audit_logs
         WHERE organization_id = $1 AND entity_type = 'position' AND entity_id = $2 AND action = 'MOVE'
         ORDER BY created_at DESC LIMIT 1`,
        [orgAId, positionHeadOpsA]
      );
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].changed_by).toBe(adminPersonAId);
      expect(audit.rows[0].reason).toBe('Promote Head of Ops to root');
      expect(audit.rows[0].old_data.parent_id).toBe(positionCeoA);
      expect(audit.rows[0].new_data.parent_id).toBeNull();
      expect(audit.rows[0].new_data.path).toMatch(/\.head_ops$/);
    });

    it('should reject unauthorized users from moving a node to root', async () => {
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${employeeTokenA}`)
        .send({
          type: 'position',
          positionId: positionAnalystJrA,
          targetParentPositionId: null,
          reason: 'Employee attempting move to root'
        });

      expect(res.status).toBe(403);

      const stillChild = await db.query(
        'SELECT parent_id FROM positions WHERE id = $1',
        [positionAnalystJrA]
      );
      expect(stillChild.rows[0].parent_id).toBe(positionAnalystA);
    });
  });

  describe('9. HR Manager authorization (existing RBAC)', () => {

    it('should grant manage_hierarchy to the HR Manager role by project design', async () => {
      const mapping = await db.query(
        `SELECT r.name AS role_name, p.name AS permission_name
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE r.organization_id = $1 AND r.name = 'HR Manager' AND p.name = 'manage_hierarchy'`,
        [orgAId]
      );
      expect(mapping.rows.length).toBe(1);
    });

    it('should allow an authorized HR Manager to reorganize hierarchy', async () => {
      // Move Junior Analyst to report to CEO — HR Manager has manage_hierarchy
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${hrManagerTokenA}`)
        .send({
          type: 'position',
          positionId: positionAnalystJrA,
          targetParentPositionId: positionCeoA,
          reason: 'HR Manager authorized reorg'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.newParentId).toBe(positionCeoA);

      const after = await db.query('SELECT parent_id FROM positions WHERE id = $1', [positionAnalystJrA]);
      expect(after.rows[0].parent_id).toBe(positionCeoA);
    });

    it('should reject an HR Manager who does not have manage_hierarchy (server-side)', async () => {
      const before = await db.query('SELECT parent_id FROM positions WHERE id = $1', [positionTenantB]);

      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${hrManagerUnauthTokenB}`)
        .send({
          type: 'position',
          positionId: positionTenantB,
          targetParentPositionId: null,
          reason: 'Unauthorized HR Manager attempt'
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/manage_hierarchy/i);

      const after = await db.query('SELECT parent_id FROM positions WHERE id = $1', [positionTenantB]);
      expect(after.rows[0].parent_id).toBe(before.rows[0].parent_id);
    });

    it('should keep Employee read-only even when sending a valid mutation payload', async () => {
      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${employeeTokenA}`)
        .send({
          type: 'position',
          positionId: positionMgrAA,
          targetParentPositionId: positionVpEngA,
          reason: 'Employee mutation attempt'
        });

      expect(res.status).toBe(403);

      const getRes = await request(app)
        .get('/api/org/hierarchy')
        .set('Authorization', `Bearer ${employeeTokenA}`);
      expect(getRes.status).toBe(200);
    });
  });

  describe('10. Multi-level subtree repath', () => {

    it('should move a subtree to a new parent, repath all descendants, and preserve child links', async () => {
      const before = await db.query(
        `SELECT id, parent_id, path::text AS path FROM positions WHERE id = ANY($1::uuid[])`,
        [[positionMgrAA, positionMgrBA, positionIcCA, positionVpProductA]]
      );
      const byId = Object.fromEntries(before.rows.map((r) => [r.id, r]));
      expect(byId[positionMgrAA].parent_id).toBe(positionVpProductA);
      expect(byId[positionMgrBA].parent_id).toBe(positionMgrAA);
      expect(byId[positionIcCA].parent_id).toBe(positionMgrBA);

      const res = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'position',
          positionId: positionMgrAA,
          targetParentPositionId: positionVpEngA,
          reason: 'Move Manager A subtree under VP Engineering'
        });

      expect(res.status).toBe(200);
      expect(res.body.data.newParentId).toBe(positionVpEngA);

      const after = await db.query(
        `SELECT id, parent_id, path::text AS path, organization_id FROM positions WHERE id = ANY($1::uuid[])`,
        [[positionMgrAA, positionMgrBA, positionIcCA, positionVpProductA, positionVpEngA]]
      );
      const afterById = Object.fromEntries(after.rows.map((r) => [r.id, r]));

      expect(afterById[positionMgrAA].parent_id).toBe(positionVpEngA);
      expect(afterById[positionMgrBA].parent_id).toBe(positionMgrAA);
      expect(afterById[positionIcCA].parent_id).toBe(positionMgrBA);
      expect(afterById[positionVpProductA].parent_id).toBe(positionCeoA);

      const vpEngPath = afterById[positionVpEngA].path;
      expect(afterById[positionMgrAA].path).toBe(`${vpEngPath}.mgr_a`);
      expect(afterById[positionMgrBA].path).toBe(`${vpEngPath}.mgr_a.mgr_b`);
      expect(afterById[positionIcCA].path).toBe(`${vpEngPath}.mgr_a.mgr_b.ic_c`);

      expect(afterById[positionMgrAA].path.startsWith(afterById[positionVpProductA].path + '.')).toBe(false);
      expect(afterById[positionMgrBA].path.startsWith(afterById[positionMgrAA].path + '.')).toBe(true);
      expect(afterById[positionIcCA].path.startsWith(afterById[positionMgrBA].path + '.')).toBe(true);

      after.rows.forEach((row) => {
        expect(row.organization_id).toBe(orgAId);
      });
    });

    it('should not introduce cycles after a multi-level subtree move', async () => {
      const cycleAttempt = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'position',
          positionId: positionVpEngA,
          targetParentPositionId: positionIcCA
        });

      expect(cycleAttempt.status).toBe(400);
      expect(cycleAttempt.body.message).toMatch(/circular reporting/i);
    });

    it('should write a correct audit record for the moved subtree root', async () => {
      const audit = await db.query(
        `SELECT old_data, new_data, reason, organization_id FROM audit_logs
         WHERE entity_type = 'position' AND entity_id = $1 AND action = 'MOVE'
         ORDER BY created_at DESC LIMIT 1`,
        [positionMgrAA]
      );
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].organization_id).toBe(orgAId);
      expect(audit.rows[0].reason).toBe('Move Manager A subtree under VP Engineering');
      expect(audit.rows[0].old_data.parent_id).toBe(positionVpProductA);
      expect(audit.rows[0].new_data.parent_id).toBe(positionVpEngA);
      expect(audit.rows[0].new_data.path).toMatch(/vp_eng\.mgr_a$/);
    });

    it('should not expose or mutate Tenant B positions during Tenant A subtree moves', async () => {
      const tenantBPos = await db.query(
        'SELECT parent_id, organization_id FROM positions WHERE id = $1',
        [positionTenantB]
      );
      expect(tenantBPos.rows[0].organization_id).toBe(orgBId);

      const cross = await request(app)
        .patch('/api/org/hierarchy/move')
        .set('Authorization', `Bearer ${adminTokenA}`)
        .send({
          type: 'position',
          positionId: positionTenantB,
          targetParentPositionId: positionCeoA
        });

      expect(cross.status).toBe(404);
      const unchanged = await db.query('SELECT parent_id FROM positions WHERE id = $1', [positionTenantB]);
      expect(unchanged.rows[0].parent_id).toBe(tenantBPos.rows[0].parent_id);
    });
  });

});
