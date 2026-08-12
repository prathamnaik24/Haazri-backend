import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { closePool } from '../src/config/db.js';

const RUN_ID = Date.now();
const TEST_ORG = {
  org_name: 'Invite Test Corp',
  org_slug: `invite-corp-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Admin',
  admin_last_name: 'User',
  admin_email: `admin-${RUN_ID}@invitecorp.com`,
  admin_password: 'TestPass@123',
};

let adminToken = '';
let inviteToken = '';
let employeeEmail = `emp-${RUN_ID}@invitecorp.com`;
let employeeId = '';

afterAll(async () => {
  await closePool();
});

describe('Deliverable 1 Integration Tests — Employee Invite Flow', () => {

  beforeAll(async () => {
    // 1. Register organization and obtain admin token
    const res = await request(app)
      .post('/api/auth/org/register')
      .send(TEST_ORG);

    expect(res.status).toBe(201);
    adminToken = res.body.data.tokens.accessToken;
    expect(adminToken).toBeDefined();
  });

  describe('POST /api/org/employees — Invite employee', () => {

    it('should block invite requests without auth headers', async () => {
      const res = await request(app)
        .post('/api/org/employees')
        .send({
          first_name: 'Alice',
          last_name: 'Worker',
          email: employeeEmail,
        });

      expect(res.status).toBe(401);
    });

    it('should generate employee record and return raw invite token', async () => {
      const res = await request(app)
        .post('/api/org/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          first_name: 'Alice',
          last_name: 'Worker',
          email: employeeEmail,
          phone_number: '+919999999999',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.employee.email).toBe(employeeEmail);
      expect(res.body.data.employee.is_active).toBe(true);
      expect(res.body.data.invite_token).toBeDefined();
      
      inviteToken = res.body.data.invite_token;
      employeeId = res.body.data.employee.id;
    });

    it('should reject duplicate email in the same organization', async () => {
      const res = await request(app)
        .post('/api/org/employees')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          first_name: 'Bob',
          last_name: 'Duplicate',
          email: employeeEmail,
        });

      expect(res.status).toBe(409);
      expect(res.body.status).toBe('error');
    });

  });

  describe('GET /api/org/employees — List employees', () => {

    it('should list employees including the newly created employee', async () => {
      const res = await request(app)
        .get('/api/org/employees')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.employees.length).toBeGreaterThan(0);
      
      const found = res.body.data.employees.find(e => e.id === employeeId);
      expect(found).toBeDefined();
      expect(found.first_name).toBe('Alice');
    });

  });

  describe('GET /api/org/employees/:id — Get employee profile', () => {

    it('should fetch single employee profile', async () => {
      const res = await request(app)
        .get(`/api/org/employees/${employeeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.email).toBe(employeeEmail);
      expect(res.body.data.roles).toBeDefined();
    });

  });

  describe('POST /api/auth/invite/accept — Accept invitation', () => {

    it('should reject accept invite with weak password', async () => {
      const res = await request(app)
        .post('/api/auth/invite/accept')
        .send({
          token: inviteToken,
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/at least 8 characters/i);
    });

    it('should reject invalid or expired invite token', async () => {
      const res = await request(app)
        .post('/api/auth/invite/accept')
        .send({
          token: 'invalid_token_1234567890',
          password: 'NewStrongPassword@123',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid or expired/i);
    });

    it('should activate user password and consume invitation token', async () => {
      const res = await request(app)
        .post('/api/auth/invite/accept')
        .send({
          token: inviteToken,
          password: 'NewStrongPassword@123',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.message).toMatch(/activated successfully/i);
    });

    it('should block double-consumption of the same invite token', async () => {
      const res = await request(app)
        .post('/api/auth/invite/accept')
        .send({
          token: inviteToken,
          password: 'AnotherStrongPassword@123',
        });

      expect(res.status).toBe(400);
    });

  });

  describe('Employee Login Verification', () => {

    it('should allow the invited employee to log in with new password', async () => {
      const res = await request(app)
        .post('/api/auth/employee/login')
        .send({
          org_slug: TEST_ORG.org_slug,
          email: employeeEmail,
          password: 'NewStrongPassword@123',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data.tokens.accessToken).toBeDefined();
      expect(res.body.data.roles).toContain('Employee');
    });

  });

});
