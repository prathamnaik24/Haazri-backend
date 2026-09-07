import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { closePool } from '../src/config/db.js';
import { db } from '../src/db/index.js';

const RUN_ID = Date.now();

const TEST_ORG = {
  org_name: 'Resignation Test Org Phase 2',
  org_slug: `resign-p2-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Super',
  admin_last_name: 'Admin',
  admin_email: `admin-${RUN_ID}@resignp2.test`,
  admin_password: 'TestPass@123',
};

let adminToken = '';
let managerToken = '';
let employeeToken = '';
let employee2Token = '';

let employeePersonId = '';
let employee2PersonId = '';
let managerPersonId = '';

let employeePositionId = '';
let employee2PositionId = '';
let managerPositionId = '';
let orgId = '';

afterAll(async () => {
  await closePool();
});

describe('Phase 1 & Phase 2 — Resignation Management Workflow & Security Hardening', () => {
  beforeAll(async () => {
    // 1. Register Org & Admin
    const orgRes = await request(app).post('/api/auth/org/register').send(TEST_ORG);
    expect(orgRes.status).toBe(201);
    adminToken = orgRes.body.data.tokens.accessToken;
    orgId = orgRes.body.data.organization.id;

    // 2. Create Manager Employee
    const mgrRes = await request(app)
      .post('/api/org/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Manager',
        last_name: 'One',
        email: `manager-${RUN_ID}@resignp2.test`,
        employee_id: `MGR-${RUN_ID}`,
      });
    expect(mgrRes.status).toBe(201);
    const mgrInviteToken = mgrRes.body.data.invite_token;
    managerPersonId = mgrRes.body.data.employee.id;

    await request(app)
      .post('/api/auth/invite/accept')
      .send({ token: mgrInviteToken, password: 'Password@123' });

    const mgrLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: `manager-${RUN_ID}@resignp2.test`,
        password: 'Password@123',
      });
    expect(mgrLogin.status).toBe(200);
    managerToken = mgrLogin.body.data.tokens.accessToken;

    // 3. Create Direct Report Employee (Rohan)
    const empRes = await request(app)
      .post('/api/org/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Rohan',
        last_name: 'Sharma',
        email: `rohan-${RUN_ID}@resignp2.test`,
        employee_id: `EMP-${RUN_ID}`,
      });
    expect(empRes.status).toBe(201);
    const empInviteToken = empRes.body.data.invite_token;
    employeePersonId = empRes.body.data.employee.id;

    await request(app)
      .post('/api/auth/invite/accept')
      .send({ token: empInviteToken, password: 'Password@123' });

    const empLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: `rohan-${RUN_ID}@resignp2.test`,
        password: 'Password@123',
      });
    expect(empLogin.status).toBe(200);
    employeeToken = empLogin.body.data.tokens.accessToken;

    // 4. Create Unrelated Employee (Employee 2 - Priya)
    const emp2Res = await request(app)
      .post('/api/org/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Priya',
        last_name: 'Patel',
        email: `priya-${RUN_ID}@resignp2.test`,
        employee_id: `EMP2-${RUN_ID}`,
      });
    expect(emp2Res.status).toBe(201);
    const emp2InviteToken = emp2Res.body.data.invite_token;
    employee2PersonId = emp2Res.body.data.employee.id;

    await request(app)
      .post('/api/auth/invite/accept')
      .send({ token: emp2InviteToken, password: 'Password@123' });

    const emp2Login = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: `priya-${RUN_ID}@resignp2.test`,
        password: 'Password@123',
      });
    expect(emp2Login.status).toBe(200);
    employee2Token = emp2Login.body.data.tokens.accessToken;

    // 5. Hierarchy Setup:
    // Manager Position -> Direct Report Position (Rohan)
    // Standalone Unrelated Position (Priya)
    const orgSlugLtree = TEST_ORG.org_slug.replace(/-/g, '_');

    const mgrPosRes = await db.query(
      `INSERT INTO positions (organization_id, title, path, is_active)
       VALUES ($1, 'Engineering Manager', $2::ltree, true) RETURNING id`,
      [orgId, `${orgSlugLtree}.eng_mgr`]
    );
    managerPositionId = mgrPosRes.rows[0].id;

    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, CURRENT_DATE)`,
      [managerPersonId, managerPositionId]
    );

    const empPosRes = await db.query(
      `INSERT INTO positions (organization_id, parent_id, title, path, is_active)
       VALUES ($1, $2, 'Senior Developer', $3::ltree, true) RETURNING id`,
      [orgId, managerPositionId, `${orgSlugLtree}.eng_mgr.sr_dev`]
    );
    employeePositionId = empPosRes.rows[0].id;

    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, CURRENT_DATE)`,
      [employeePersonId, employeePositionId]
    );

    // Position for Priya (Unrelated position: reporting to a different top position or separate branch)
    const otherMgrPosRes = await db.query(
      `INSERT INTO positions (organization_id, parent_id, title, path, is_active)
       VALUES ($1, $2, 'Design Lead', $3::ltree, true) RETURNING id`,
      [orgId, managerPositionId, `${orgSlugLtree}.eng_mgr.design_lead`]
    );
    const otherMgrPositionId = otherMgrPosRes.rows[0].id;

    const emp2PosRes = await db.query(
      `INSERT INTO positions (organization_id, parent_id, title, path, is_active)
       VALUES ($1, $2, 'Product Designer', $3::ltree, true) RETURNING id`,
      [orgId, otherMgrPositionId, `${orgSlugLtree}.eng_mgr.design_lead.designer`]
    );
    employee2PositionId = emp2PosRes.rows[0].id;

    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, CURRENT_DATE)`,
      [employee2PersonId, employee2PositionId]
    );
  });

  // ── PHASE 1 CORE LIFECYCLE ────────────────────────────────────────────────
  it('1. Employee submits resignation -> status = PENDING_MANAGER_REVIEW and employee remains ACTIVE', async () => {
    const res = await request(app)
      .post('/api/resignation')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        proposed_last_working_day: '2026-10-01',
        reason: 'Career opportunity',
        comments: 'Moving to a new role',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.resignation.status).toBe('PENDING_MANAGER_REVIEW');
    expect(res.body.data.resignation.proposed_last_working_day).toBeDefined();

    const empCheck = await db.query('SELECT employment_status FROM persons WHERE id = $1', [employeePersonId]);
    expect(empCheck.rows[0].employment_status).toBe('ACTIVE');
  });

  it('2. Prevents duplicate active resignations for the same employee', async () => {
    const res = await request(app)
      .post('/api/resignation')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        proposed_last_working_day: '2026-11-01',
        reason: 'Duplicate attempt',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/active resignation request already exists/i);
  });

  it('3. Prevents unauthorized employee from approving own resignation', async () => {
    const myResignations = await request(app)
      .get('/api/resignation/my')
      .set('Authorization', `Bearer ${employeeToken}`);
    
    expect(myResignations.status).toBe(200);
    const resignationId = myResignations.body.data.resignations[0].id;

    const actionRes = await request(app)
      .post(`/api/resignation/${resignationId}/manager-action`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ action: 'APPROVE' });

    expect(actionRes.status).toBe(403);
  });

  it('4. Manager approves resignation -> transitions to HR_REVIEW', async () => {
    const myResignations = await request(app)
      .get('/api/resignation/my')
      .set('Authorization', `Bearer ${employeeToken}`);
    
    const resignationId = myResignations.body.data.resignations[0].id;

    const actionRes = await request(app)
      .post(`/api/resignation/${resignationId}/manager-action`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ action: 'APPROVE', comment: 'Recommended for approval' });

    expect(actionRes.status).toBe(200);
    expect(actionRes.body.data.resignation.status).toBe('HR_REVIEW');
    expect(actionRes.body.data.resignation.manager_id).toBe(managerPersonId);
  });

  it('5. HR approves resignation -> transitions to NOTICE_PERIOD while employee remains ACTIVE', async () => {
    const myResignations = await request(app)
      .get('/api/resignation/my')
      .set('Authorization', `Bearer ${employeeToken}`);
    
    const resignationId = myResignations.body.data.resignations[0].id;

    const hrApprove = await request(app)
      .post(`/api/resignation/${resignationId}/hr-action`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ approved_last_working_day: '2026-10-01', comment: 'HR approved' });

    expect(hrApprove.status).toBe(200);
    expect(hrApprove.body.data.resignation.status).toBe('NOTICE_PERIOD');

    const empCheck = await db.query('SELECT employment_status FROM persons WHERE id = $1', [employeePersonId]);
    expect(empCheck.rows[0].employment_status).toBe('ACTIVE');
  });

  it('6. HR completes resignation -> status = COMPLETED, employee = RESIGNED, position preserved', async () => {
    const myResignations = await request(app)
      .get('/api/resignation/my')
      .set('Authorization', `Bearer ${employeeToken}`);
    
    const resignationId = myResignations.body.data.resignations[0].id;

    const posCountBefore = await db.query('SELECT COUNT(*) FROM positions WHERE organization_id = $1', [orgId]);

    const completeRes = await request(app)
      .post(`/api/resignation/${resignationId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'Final exit formalities completed' });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.resignation.status).toBe('COMPLETED');

    const empCheck = await db.query('SELECT employment_status FROM persons WHERE id = $1', [employeePersonId]);
    expect(empCheck.rows[0].employment_status).toBe('RESIGNED');

    // POSITION REGRESSION TEST: Count of positions must remain strictly unchanged!
    const posCountAfter = await db.query('SELECT COUNT(*) FROM positions WHERE organization_id = $1', [orgId]);
    expect(posCountAfter.rows[0].count).toBe(posCountBefore.rows[0].count);

    // Verify position record in database is completely intact
    const posAfter = await db.query('SELECT * FROM positions WHERE id = $1', [employeePositionId]);
    expect(posAfter.rows.length).toBe(1);
    expect(posAfter.rows[0].id).toBe(employeePositionId);
  });

  // ── PHASE 2 HARDENING & SECURITY TESTS ──────────────────────────────────
  it('7. IDOR Protection: Employee 2 cannot access Employee 1 resignation by ID', async () => {
    const myResignations = await request(app)
      .get('/api/resignation/my')
      .set('Authorization', `Bearer ${employeeToken}`);
    const resignationId = myResignations.body.data.resignations[0].id;

    const idorCheck = await request(app)
      .get(`/api/resignation/${resignationId}`)
      .set('Authorization', `Bearer ${employee2Token}`);

    expect(idorCheck.status).toBe(403);
    expect(idorCheck.body.message).toMatch(/not authorized to view/i);
  });

  it('8. Manager Authorization: Manager cannot review an unrelated employee resignation', async () => {
    // Submit resignation for Employee 2 (Priya, who does NOT report to Manager)
    const subRes = await request(app)
      .post('/api/resignation')
      .set('Authorization', `Bearer ${employee2Token}`)
      .send({
        proposed_last_working_day: '2026-11-15',
        reason: 'Personal reasons',
      });
    expect(subRes.status).toBe(201);
    const priyaResignationId = subRes.body.data.resignation.id;

    // Manager tries to approve Priya's resignation
    const unauthApprove = await request(app)
      .post(`/api/resignation/${priyaResignationId}/manager-action`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ action: 'APPROVE', comment: 'Unauthorized approve attempt' });

    expect(unauthApprove.status).toBe(403);
    expect(unauthApprove.body.message).toMatch(/not authorized to review this employee resignation/i);
  });

  it('9. Non-HR Authorization: Regular employee cannot perform HR approval or completion', async () => {
    const myResignations = await request(app)
      .get('/api/resignation/my')
      .set('Authorization', `Bearer ${employee2Token}`);
    const resignationId = myResignations.body.data.resignations[0].id;

    const hrActionCheck = await request(app)
      .post(`/api/resignation/${resignationId}/hr-action`)
      .set('Authorization', `Bearer ${employee2Token}`)
      .send({ comment: 'Illegal HR action' });

    expect(hrActionCheck.status).toBe(403);

    const completeCheck = await request(app)
      .post(`/api/resignation/${resignationId}/complete`)
      .set('Authorization', `Bearer ${employee2Token}`)
      .send({});

    expect(completeCheck.status).toBe(403);
  });

  it('10. State Machine Integrity: Blocks invalid state transitions (e.g. COMPLETED -> APPROVED or REJECTED -> COMPLETED)', async () => {
    const myResignations = await request(app)
      .get('/api/resignation/my')
      .set('Authorization', `Bearer ${employeeToken}`);
    const completedResignationId = myResignations.body.data.resignations[0].id;

    // Try to perform HR action on COMPLETED resignation
    const invalid1 = await request(app)
      .post(`/api/resignation/${completedResignationId}/hr-action`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(invalid1.status).toBe(400);
    expect(invalid1.body.message).toMatch(/cannot perform HR approval on resignation with status 'COMPLETED'/i);

    // Try to perform complete on completed resignation
    const invalid2 = await request(app)
      .post(`/api/resignation/${completedResignationId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(invalid2.status).toBe(400);
    expect(invalid2.body.message).toMatch(/already completed/i);
  });

  it('11. Idempotency & Offboarding Safety: Completing an already RESIGNED employee fails cleanly', async () => {
    const myResignations = await request(app)
      .get('/api/resignation/my')
      .set('Authorization', `Bearer ${employeeToken}`);
    const completedResignationId = myResignations.body.data.resignations[0].id;

    const retryComplete = await request(app)
      .post(`/api/resignation/${completedResignationId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comment: 'Duplicate complete attempt' });

    expect(retryComplete.status).toBe(400);
  });

  it('12. Input Validation: Enforces maximum comment length & rejects invalid dates', async () => {
    // Enable Rohan temporarily for testing invalid input
    await db.query(`UPDATE persons SET employment_status = 'ACTIVE' WHERE id = $1`, [employeePersonId]);

    const longComment = 'a'.repeat(2500);

    const badDate = await request(app)
      .post('/api/resignation')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        proposed_last_working_day: 'invalid-date-string',
        reason: 'Career change',
      });
    expect(badDate.status).toBe(400);

    const tooLong = await request(app)
      .post('/api/resignation')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        proposed_last_working_day: '2026-12-01',
        reason: longComment,
      });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.message).toMatch(/must not exceed 2000 characters/i);
  });

  it('13. Audit Regression Test: Server strictly records actor ID from auth token in audit_logs', async () => {
    const audits = await db.query(
      `SELECT * FROM audit_logs WHERE organization_id = $1 AND entity_type = 'resignation' ORDER BY created_at ASC`,
      [orgId]
    );

    expect(audits.rows.length).toBeGreaterThan(0);
    const submitAudit = audits.rows.find(a => a.action === 'SUBMIT');
    expect(submitAudit).toBeDefined();
    expect(submitAudit.changed_by).toBe(employeePersonId);

    const completeAudit = audits.rows.find(a => a.action === 'COMPLETE');
    expect(completeAudit).toBeDefined();
  });
});
