import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { closePool } from '../src/config/db.js';

const RUN_ID = Date.now();

const ORG_A = {
  org_name: 'Workday Org A',
  org_slug: `workday-org-a-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Alice',
  admin_last_name: 'Admin',
  admin_email: `admin-a-${RUN_ID}@workday.test`,
  admin_password: 'TestPass@123',
};

const ORG_B = {
  org_name: 'Workday Org B',
  org_slug: `workday-org-b-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Bob',
  admin_last_name: 'Admin',
  admin_email: `admin-b-${RUN_ID}@workday.test`,
  admin_password: 'TestPass@123',
};

let adminTokenA = '';
let employeeIdA = '';
let workdayIdA = '';
let employeeTokenA = '';
let adminTokenB = '';

afterAll(async () => {
  await closePool();
});

describe('Workday ID feature', () => {
  beforeAll(async () => {
    const orgA = await request(app).post('/api/auth/org/register').send(ORG_A);
    expect(orgA.status).toBe(201);
    adminTokenA = orgA.body.data.tokens.accessToken;

    const orgB = await request(app).post('/api/auth/org/register').send(ORG_B);
    expect(orgB.status).toBe(201);
    adminTokenB = orgB.body.data.tokens.accessToken;
  });

  it('creates employees with generated workday_id values and exposes them in list/detail responses', async () => {
    const createRes = await request(app)
      .post('/api/org/employees')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        first_name: 'Charlie',
        last_name: 'Employee',
        email: `charlie-${RUN_ID}@workday.test`,
        employee_id: 'EMP-9001',
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.employee.workday_id).toMatch(/^WD-\d{6}$/);

    workdayIdA = createRes.body.data.employee.workday_id;
    employeeIdA = createRes.body.data.employee.id;

    const listRes = await request(app)
      .get('/api/org/employees')
      .set('Authorization', `Bearer ${adminTokenA}`);

    expect(listRes.status).toBe(200);
    const created = listRes.body.data.employees.find((emp) => emp.id === employeeIdA);
    expect(created.workday_id).toBe(workdayIdA);

    const detailRes = await request(app)
      .get(`/api/org/employees/${employeeIdA}`)
      .set('Authorization', `Bearer ${adminTokenA}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.workday_id).toBe(workdayIdA);
  });

  it('rejects workday_id updates and keeps the original value', async () => {
    const patchRes = await request(app)
      .patch(`/api/org/employees/${employeeIdA}`)
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({ workday_id: 'WD-999999' });

    expect(patchRes.status).toBe(400);
    expect(patchRes.body.message).toMatch(/workday_id|system-managed/i);

    const detailRes = await request(app)
      .get(`/api/org/employees/${employeeIdA}`)
      .set('Authorization', `Bearer ${adminTokenA}`);

    expect(detailRes.body.data.workday_id).toBe(workdayIdA);
  });

  it('keeps employee_id and email login working while rejecting workday_id login', async () => {
    const inviteRes = await request(app)
      .post('/api/org/employees')
      .set('Authorization', `Bearer ${adminTokenA}`)
      .send({
        first_name: 'Diana',
        last_name: 'Employee',
        email: `diana-${RUN_ID}@workday.test`,
        employee_id: 'EMP-9002',
      });

    expect(inviteRes.status).toBe(201);
    const inviteToken = inviteRes.body.data.invite_token;

    const activateRes = await request(app)
      .post('/api/auth/invite/accept')
      .send({ token: inviteToken, password: 'NewStrongPassword@123' });

    expect(activateRes.status).toBe(200);

    const emailLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: ORG_A.org_slug,
        email: `diana-${RUN_ID}@workday.test`,
        password: 'NewStrongPassword@123',
      });

    expect(emailLogin.status).toBe(200);
    expect(emailLogin.body.data.person.email).toBe(`diana-${RUN_ID}@workday.test`);

    const employeeIdLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: ORG_A.org_slug,
        employee_id: 'EMP-9002',
        password: 'NewStrongPassword@123',
      });

    expect(employeeIdLogin.status).toBe(200);

    const workdayLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: ORG_A.org_slug,
        employee_id: workdayIdA,
        password: 'NewStrongPassword@123',
      });

    expect(workdayLogin.status).toBe(401);
  });

  it('keeps workday IDs globally unique across organizations and available in auth profile', async () => {
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminTokenA}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.workday_id).toBeDefined();

    const secondEmployee = await request(app)
      .post('/api/org/employees')
      .set('Authorization', `Bearer ${adminTokenB}`)
      .send({
        first_name: 'Eve',
        last_name: 'Worker',
        email: `eve-${RUN_ID}@other.test`,
        employee_id: 'EMP-1001',
      });

    expect(secondEmployee.status).toBe(201);
    expect(secondEmployee.body.data.employee.workday_id).not.toBe(workdayIdA);
    expect(secondEmployee.body.data.employee.workday_id).toMatch(/^WD-\d{6}$/);
  });
});
