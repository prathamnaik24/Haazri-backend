import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { db } from '../src/db/index.js';
import { closePool } from '../src/config/db.js';
import bcrypt from 'bcryptjs';

const RUN_ID = Date.now();
const TEST_ORG = {
  org_name: 'Attendance Test Corp',
  org_slug: `att-corp-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Owner',
  admin_last_name: 'Admin',
  admin_email: `owner-${RUN_ID}@attcorp.com`,
  admin_password: 'TestPass@123',
};

let adminToken = '';
let managerToken = '';
let employeeToken = '';

let orgId = '';
let adminId = '';
let managerId = '';
let employeeId = '';

afterAll(async () => {
  await closePool();
});

describe('Deliverable 2 Integration Tests — Attendance Loop', () => {

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
       VALUES ($1, 'Mark', 'Manager', 'cto-${RUN_ID}@attcorp.com', $2, true) RETURNING id`,
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
       VALUES ($1, 'Emily', 'Employee', 'dev-${RUN_ID}@attcorp.com', $2, true) RETURNING id`,
      [orgId, passwordHash]
    );
    employeeId = employeeRes.rows[0].id;

    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, current_date)`,
      [employeeId, devPosId]
    );

    // 5. Generate Access Tokens via Login route
    const managerLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: `cto-${RUN_ID}@attcorp.com`,
        password: 'TestPass@123',
      });
    expect(managerLogin.status).toBe(200);
    managerToken = managerLogin.body.data.tokens.accessToken;

    const employeeLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: `dev-${RUN_ID}@attcorp.com`,
        password: 'TestPass@123',
      });
    expect(employeeLogin.status).toBe(200);
    employeeToken = employeeLogin.body.data.tokens.accessToken;
  });

  describe('POST /api/attendance/check-in', () => {

    it('should successfully check in the employee for today', async () => {
      const res = await request(app)
        .post('/api/attendance/check-in')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          metadata: {
            gps: { lat: 19.076, lng: 72.877 }, // Mumbai HQ
            device_id: 'device_iphone_15_test',
          }
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.work_date).toBeDefined();
      expect(res.body.data.check_in_time).toBeDefined();
      expect(res.body.data.status).toBe('Present');
      expect(res.body.data.metadata.device_id).toBe('device_iphone_15_test');
    });

    it('should reject double check-in for the same employee today', async () => {
      const res = await request(app)
        .post('/api/attendance/check-in')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/already checked in/i);
    });

  });

  describe('GET /api/attendance/me — Own history', () => {

    it('should return employee own check-in list', async () => {
      const res = await request(app)
        .get('/api/attendance/me')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.history.length).toBe(1);
      expect(res.body.data.history[0].check_in_time).toBeDefined();
      expect(res.body.data.history[0].check_out_time).toBeNull();
    });

  });

  describe('POST /api/attendance/check-out', () => {

    it('should successfully check out the employee and calculate duration', async () => {
      const res = await request(app)
        .post('/api/attendance/check-out')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.check_out_time).toBeDefined();
      expect(res.body.data.metadata.total_hours).toBeDefined();
    });

    it('should reject check-out if no active check-in session is running', async () => {
      const res = await request(app)
        .post('/api/attendance/check-out')
        .set('Authorization', `Bearer ${employeeToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no active check-in record found/i);
    });

  });

  describe('GET /api/attendance/team — Manager team view', () => {

    it('should allow CTO to view Dev subordinate attendance logs', async () => {
      const res = await request(app)
        .get('/api/attendance/team')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.team_history.length).toBeGreaterThan(0);
      
      const entry = res.body.data.team_history.find(h => h.employee.id === employeeId);
      expect(entry).toBeDefined();
      expect(entry.employee.first_name).toBe('Emily');
      expect(entry.employee.position.title).toBe('Senior Developer');
    });

    it('should exclude CEO or unrelated staff logs from CTO view (only reports descendants)', async () => {
      // Admin (CEO) checks in
      await request(app)
        .post('/api/attendance/check-in')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      // CTO fetches logs
      const res = await request(app)
        .get('/api/attendance/team')
        .set('Authorization', `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      
      // Admin (CEO) is higher in hierarchy (root), so CTO (root.cto) should NOT see CEO's check-in
      const ceoEntry = res.body.data.team_history.find(h => h.employee.id === adminId);
      expect(ceoEntry).toBeUndefined();
    });

  });

});
