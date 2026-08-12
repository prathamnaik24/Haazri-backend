import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { db } from '../src/db/index.js';
import { closePool } from '../src/config/db.js';
import bcrypt from 'bcryptjs';

const RUN_ID = Date.now();
const TEST_ORG = {
  org_name: 'Leaves Test Corp',
  org_slug: `leave-corp-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Owner',
  admin_last_name: 'Admin',
  admin_email: `owner-${RUN_ID}@leavecorp.com`,
  admin_password: 'TestPass@123',
};

let adminToken = '';
let managerToken = '';
let employeeToken = '';

let orgId = '';
let adminId = '';
let managerId = '';
let employeeId = '';

let sickLeaveTypeId = '';

afterAll(async () => {
  await closePool();
});

describe('Deliverable 3 Integration Tests — Leave Request Loop', () => {

  beforeAll(async () => {
    // 1. Register organization and obtain admin credentials
    const regRes = await request(app)
      .post('/api/auth/org/register')
      .send(TEST_ORG);

    expect(regRes.status).toBe(201);
    adminToken = regRes.body.data.tokens.accessToken;
    orgId = regRes.body.data.organization.id;
    adminId = regRes.body.data.person.id;

    // 2. Set up positions in database directly
    const passwordHash = await bcrypt.hash('TestPass@123', 12);
    
    // CEO position
    const ceoPos = await db.query(
      `INSERT INTO positions (organization_id, title, path, is_active)
       VALUES ($1, 'CEO', 'root_${RUN_ID}'::ltree, true) RETURNING id`,
      [orgId]
    );
    const ceoPosId = ceoPos.rows[0].id;

    // Assign Admin to CEO
    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, current_date)`,
      [adminId, ceoPosId]
    );

    // CTO position (reports to CEO)
    const ctoPos = await db.query(
      `INSERT INTO positions (organization_id, parent_id, title, path, is_active)
       VALUES ($1, $2, 'CTO', 'root_${RUN_ID}.cto'::ltree, true) RETURNING id`
      , [orgId, ceoPosId]
    );
    const ctoPosId = ctoPos.rows[0].id;

    // Senior Dev position (reports to CTO)
    const devPos = await db.query(
      `INSERT INTO positions (organization_id, parent_id, title, path, is_active)
       VALUES ($1, $2, 'Senior Developer', 'root_${RUN_ID}.cto.senior_dev'::ltree, true) RETURNING id`
      , [orgId, ctoPosId]
    );
    const devPosId = devPos.rows[0].id;

    // 3. Create Manager (CTO) Person
    const managerRes = await db.query(
      `INSERT INTO persons (organization_id, first_name, last_name, email, password_hash, is_active)
       VALUES ($1, 'Mark', 'Manager', 'cto-${RUN_ID}@leavecorp.com', $2, true) RETURNING id`,
      [orgId, passwordHash]
    );
    managerId = managerRes.rows[0].id;

    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, current_date)`,
      [managerId, ctoPosId]
    );

    // 4. Create Employee (Dev) Person
    const employeeRes = await db.query(
      `INSERT INTO persons (organization_id, first_name, last_name, email, password_hash, is_active)
       VALUES ($1, 'Emily', 'Employee', 'dev-${RUN_ID}@leavecorp.com', $2, true) RETURNING id`,
      [orgId, passwordHash]
    );
    employeeId = employeeRes.rows[0].id;

    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, current_date)`,
      [employeeId, devPosId]
    );

    // 5. Create default Leave Type and Policy for organization
    const leaveTypeRes = await db.query(
      `INSERT INTO leave_types (organization_id, name, is_paid, is_active)
       VALUES ($1, 'Sick Leave', true, true) RETURNING id`,
      [orgId]
    );
    sickLeaveTypeId = leaveTypeRes.rows[0].id;

    await db.query(
      `INSERT INTO leave_policies (leave_type_id, days_allowed, carry_forward_allowed)
       VALUES ($1, 10.0, false)`,
      [sickLeaveTypeId]
    );

    // 6. Generate Access Tokens via Login route
    const managerLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: `cto-${RUN_ID}@leavecorp.com`,
        password: 'TestPass@123',
      });
    managerToken = managerLogin.body.data.tokens.accessToken;

    const employeeLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: `dev-${RUN_ID}@leavecorp.com`,
        password: 'TestPass@123',
      });
    employeeToken = employeeLogin.body.data.tokens.accessToken;
  });

  describe('POST /api/leaves/request — Submit request', () => {

    it('should successfully submit leave request and deduct balance', async () => {
      // Requests 3 days (12 Aug to 14 Aug)
      const res = await request(app)
        .post('/api/leaves/request')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          leave_type_id: sickLeaveTypeId,
          start_date: '2026-08-12',
          end_date: '2026-08-14',
          reason: 'Fever recovery',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.status).toBe('Pending');
      expect(res.body.data.duration_days).toBe(3);
      expect(parseFloat(res.body.data.remaining_balance)).toBe(7.0);
    });

    it('should reject requests that exceed remaining leave balance', async () => {
      // Remaining is 7, request 8 days
      const res = await request(app)
        .post('/api/leaves/request')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          leave_type_id: sickLeaveTypeId,
          start_date: '2026-08-20',
          end_date: '2026-08-27', // 8 days
          reason: 'Vacation',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/insufficient leave balance/i);
    });

  });

  describe('GET /api/leaves/me — View own status', () => {

    it('should retrieve leave request history and active balances', async () => {
      const res = await request(app)
        .get('/api/leaves/me')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.requests.length).toBe(1);
      expect(res.body.data.requests[0].leave_type_name).toBe('Sick Leave');
      
      expect(res.body.data.balances.length).toBe(1);
      expect(parseFloat(res.body.data.balances[0].balance)).toBe(7.0);
    });

  });

  describe('GET /api/leaves/team/pending — Manager view pending', () => {

    it('should show pending request to the direct manager (CTO)', async () => {
      const res = await request(app)
        .get('/api/leaves/team/pending')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].employee.first_name).toBe('Emily');
    });

  });

  describe('PATCH /api/leaves/request/:id/action — Manager action', () => {

    let leaveRequestId = '';

    beforeAll(async () => {
      // Find the pending request id
      const res = await request(app)
        .get('/api/leaves/team/pending')
        .set('Authorization', `Bearer ${managerToken}`);
      leaveRequestId = res.body.data[0].id;
    });

    it('should successfully reject request and restore balance', async () => {
      const rejectRes = await request(app)
        .patch(`/api/leaves/request/${leaveRequestId}/action`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'Rejected' });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe('success');
      expect(rejectRes.body.data.status).toBe('Rejected');

      // Verify balance is restored back to 10.0
      const balanceRes = await request(app)
        .get('/api/leaves/me')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(parseFloat(balanceRes.body.data.balances[0].balance)).toBe(10.0);
    });

    it('should successfully approve request and maintain deduction', async () => {
      // Create new request for 2 days (balance: 10 -> 8)
      const submitRes = await request(app)
        .post('/api/leaves/request')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          leave_type_id: sickLeaveTypeId,
          start_date: '2026-08-15',
          end_date: '2026-08-16',
        });
      expect(submitRes.status).toBe(201);
      const newRequestId = submitRes.body.data.id;

      // Approve request
      const approveRes = await request(app)
        .patch(`/api/leaves/request/${newRequestId}/action`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ action: 'Approved' });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.data.status).toBe('Approved');

      // Verify balance remains 8.0
      const balanceRes = await request(app)
        .get('/api/leaves/me')
        .set('Authorization', `Bearer ${employeeToken}`);
      expect(parseFloat(balanceRes.body.data.balances[0].balance)).toBe(8.0);
    });

  });

});
