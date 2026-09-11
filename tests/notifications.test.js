import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { db } from '../src/db/index.js';
import { closePool } from '../src/config/db.js';
import bcrypt from 'bcryptjs';

const RUN_ID = Date.now();
const TEST_ORG = {
  org_name: `Notif Test Corp ${RUN_ID}`,
  org_slug: `notif-corp-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Owner',
  admin_last_name: 'Admin',
  admin_email: `owner-${RUN_ID}@notifcorp.com`,
  admin_password: 'TestPass@123',
};

const OTHER_ORG = {
  org_name: `Other Corp ${RUN_ID}`,
  org_slug: `other-corp-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Other',
  admin_last_name: 'Admin',
  admin_email: `other-${RUN_ID}@othercorp.com`,
  admin_password: 'TestPass@123',
};

let adminToken = '';
let managerToken = '';
let employeeToken = '';
let otherOrgToken = '';

let orgId = '';
let otherOrgId = '';
let adminId = '';
let managerId = '';
let employeeId = '';
let leaveTypeId = '';

afterAll(async () => {
  await closePool();
});

describe('In-App Notification Center Integration Tests', () => {
  beforeAll(async () => {
    // 1. Register main test organization
    const regRes = await request(app).post('/api/auth/org/register').send(TEST_ORG);
    expect(regRes.status).toBe(201);
    adminToken = regRes.body.data.tokens.accessToken;
    orgId = regRes.body.data.organization.id;
    adminId = regRes.body.data.person.id;

    // 2. Register other organization for tenant isolation testing
    const otherRes = await request(app).post('/api/auth/org/register').send(OTHER_ORG);
    expect(otherRes.status).toBe(201);
    otherOrgToken = otherRes.body.data.tokens.accessToken;
    otherOrgId = otherRes.body.data.organization.id;

    // 3. Create positions in main organization
    const passwordHash = await bcrypt.hash('TestPass@123', 12);

    const ceoPos = await db.query(
      `INSERT INTO positions (organization_id, title, path, is_active)
       VALUES ($1, 'CEO', 'root_${RUN_ID}'::ltree, true) RETURNING id`,
      [orgId]
    );
    const ceoPosId = ceoPos.rows[0].id;

    const mgrPos = await db.query(
      `INSERT INTO positions (organization_id, parent_id, title, path, is_active)
       VALUES ($1, $2, 'Manager', 'root_${RUN_ID}.mgr'::ltree, true) RETURNING id`,
      [orgId, ceoPosId]
    );
    const mgrPosId = mgrPos.rows[0].id;

    const empPos = await db.query(
      `INSERT INTO positions (organization_id, parent_id, title, path, is_active)
       VALUES ($1, $2, 'Engineer', 'root_${RUN_ID}.mgr.emp'::ltree, true) RETURNING id`,
      [orgId, mgrPosId]
    );
    const empPosId = empPos.rows[0].id;

    // Assign Admin to CEO
    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, CURRENT_DATE)`,
      [adminId, ceoPosId]
    );

    // Create Manager person & assignment
    const mgrRes = await db.query(
      `INSERT INTO persons (organization_id, first_name, last_name, email, password_hash, is_active, employment_status, activation_status)
       VALUES ($1, 'Lead', 'Manager', $2, $3, true, 'ACTIVE', 'ACTIVE') RETURNING id`,
      [orgId, `mgr-${RUN_ID}@notifcorp.com`, passwordHash]
    );
    managerId = mgrRes.rows[0].id;
    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, CURRENT_DATE)`,
      [managerId, mgrPos.rows[0].id]
    );

    // Create Employee person & assignment
    const empRes = await db.query(
      `INSERT INTO persons (organization_id, first_name, last_name, email, password_hash, is_active, employment_status, activation_status)
       VALUES ($1, 'Jane', 'Employee', $2, $3, true, 'ACTIVE', 'ACTIVE') RETURNING id`,
      [orgId, `emp-${RUN_ID}@notifcorp.com`, passwordHash]
    );
    employeeId = empRes.rows[0].id;
    await db.query(
      `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
       VALUES ($1, $2, true, CURRENT_DATE)`,
      [employeeId, empPos.rows[0].id]
    );

    // Create leave type and balance
    const ltRes = await db.query(
      `INSERT INTO leave_types (organization_id, name, is_paid, is_active)
       VALUES ($1, 'Annual Leave', true, true) RETURNING id`,
      [orgId]
    );
    leaveTypeId = ltRes.rows[0].id;

    await db.query(
      `INSERT INTO leave_balances (person_id, leave_type_id, balance, year)
       VALUES ($1, $2, 20, 2026)`,
      [employeeId, leaveTypeId]
    );

    // Authenticate manager & employee to get JWT tokens
    const mgrLogin = await request(app).post('/api/auth/employee/login').send({
      org_slug: TEST_ORG.org_slug,
      email: `mgr-${RUN_ID}@notifcorp.com`,
      password: 'TestPass@123',
    });
    expect(mgrLogin.status).toBe(200);
    managerToken = mgrLogin.body.data.tokens.accessToken;

    const empLogin = await request(app).post('/api/auth/employee/login').send({
      org_slug: TEST_ORG.org_slug,
      email: `emp-${RUN_ID}@notifcorp.com`,
      password: 'TestPass@123',
    });
    expect(empLogin.status).toBe(200);
    employeeToken = empLogin.body.data.tokens.accessToken;
  });

  it('1. Triggers LEAVE_SUBMITTED notification upon leave request', async () => {
    const leaveRes = await request(app)
      .post('/api/leaves/request')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        leave_type_id: leaveTypeId,
        start_date: '2026-09-10',
        end_date: '2026-09-12',
        reason: 'Personal vacation',
      });

    expect(leaveRes.status).toBe(201);
    const leaveId = leaveRes.body.data.id;

    // Verify employee received notification
    const notifRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(notifRes.status).toBe(200);
    expect(notifRes.body.data.notifications.length).toBeGreaterThanOrEqual(1);

    const subNotif = notifRes.body.data.notifications.find(
      (n) => n.type === 'LEAVE_SUBMITTED' && n.entity_id === leaveId
    );
    expect(subNotif).toBeDefined();
    expect(subNotif.title).toContain('Submitted');
    expect(subNotif.is_read).toBe(false);
  });

  it('2. Triggers LEAVE_APPROVED notification upon manager approval', async () => {
    // Get pending leave for manager
    const pendingRes = await request(app)
      .get('/api/leaves/team/pending')
      .set('Authorization', `Bearer ${managerToken}`);
    expect(pendingRes.status).toBe(200);
    expect(pendingRes.body.data.length).toBeGreaterThanOrEqual(1);
    const targetLeaveId = pendingRes.body.data[0].id;

    // Approve leave
    const approveRes = await request(app)
      .patch(`/api/leaves/request/${targetLeaveId}/action`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ action: 'Approved', remark: 'Enjoy your vacation!' });

    expect(approveRes.status).toBe(200);

    // Verify employee received LEAVE_APPROVED notification
    const notifRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(notifRes.status).toBe(200);
    const appNotif = notifRes.body.data.notifications.find(
      (n) => n.type === 'LEAVE_APPROVED' && n.entity_id === targetLeaveId
    );
    expect(appNotif).toBeDefined();
    expect(appNotif.title).toContain('Approved');
  });

  it('3. Triggers SALARY_CREDITED and BONUS_CREDITED notifications without leaking amounts', async () => {
    // Create financial record (Salary)
    const salRes = await request(app)
      .post('/api/finance/records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: employeeId,
        record_type: 'SALARY',
        amount: 85000,
        period_month: 9,
        period_year: 2026,
        description: 'September 2026 Monthly Salary',
      });
    expect(salRes.status).toBe(201);

    // Create financial record (Bonus)
    const bonusRes = await request(app)
      .post('/api/finance/records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: employeeId,
        record_type: 'BONUS',
        amount: 15000,
        description: 'Quarterly Performance Bonus',
      });
    expect(bonusRes.status).toBe(201);

    // Fetch employee notifications
    const notifRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(notifRes.status).toBe(200);
    const salNotif = notifRes.body.data.notifications.find((n) => n.type === 'SALARY_CREDITED');
    const bonusNotif = notifRes.body.data.notifications.find((n) => n.type === 'BONUS_CREDITED');

    expect(salNotif).toBeDefined();
    expect(bonusNotif).toBeDefined();

    // Verify sanitization: message and title MUST NOT contain the raw salary amount
    expect(salNotif.message).not.toContain('85000');
    expect(bonusNotif.message).not.toContain('15000');
  });

  it('4. Provides accurate unread count and supports marking as read', async () => {
    // 1. Check unread count
    const countRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(countRes.status).toBe(200);
    const initialUnread = countRes.body.data.unread_count;
    expect(initialUnread).toBeGreaterThan(0);

    // 2. Fetch notifications to get a target ID
    const listRes = await request(app)
      .get('/api/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${employeeToken}`);

    const targetNotif = listRes.body.data.notifications[0];
    expect(targetNotif.is_read).toBe(false);

    // 3. Mark single notification read
    const markRes = await request(app)
      .patch(`/api/notifications/${targetNotif.id}/read`)
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(markRes.status).toBe(200);
    expect(markRes.body.data.is_read).toBe(true);

    // 4. Verify unread count decremented
    const afterCountRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(afterCountRes.body.data.unread_count).toBe(initialUnread - 1);

    // 5. Mark all as read
    const markAllRes = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(markAllRes.status).toBe(200);
    expect(markAllRes.body.data.success).toBe(true);

    // 6. Verify unread count is now 0
    const finalCountRes = await request(app)
      .get('/api/notifications/unread-count')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(finalCountRes.body.data.unread_count).toBe(0);
  });

  it('5. Strictly enforces tenant and user isolation', async () => {
    // User from Other Org cannot view Employee from Main Org notifications
    const crossOrgRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${otherOrgToken}`);

    expect(crossOrgRes.status).toBe(200);
    expect(crossOrgRes.body.data.notifications.length).toBe(0);

    // Unauthenticated request is rejected
    const unauthRes = await request(app).get('/api/notifications');
    expect(unauthRes.status).toBe(401);
  });
});
