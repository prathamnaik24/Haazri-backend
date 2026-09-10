import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../src/app.js';
import { db } from '../src/db/index.js';

describe('Employee Onboarding & SHA-256 Activation Flow', () => {
  const RUN_ID = Date.now();
  const TEST_ORG = {
    org_name: `Onboard Corp ${RUN_ID}`,
    org_slug: `onboard-${RUN_ID}`,
    admin_first_name: 'Admin',
    admin_last_name: 'Owner',
    admin_email: `admin-${RUN_ID}@onboard.com`,
    admin_password: 'Password@123',
  };

  let adminToken;
  let employeeId;
  let rawActivationToken;
  let activationLink;
  const empEmail = `newhire-${RUN_ID}@onboard.com`;

  beforeAll(async () => {
    // 1. Register test org
    const regRes = await request(app)
      .post('/api/auth/org/register')
      .send(TEST_ORG);

    expect(regRes.status).toBe(201);
    adminToken = regRes.body.data.tokens.accessToken;
  });

  it('1. Creates employee with PENDING_ACTIVATION status and SHA-256 token', async () => {
    const res = await request(app)
      .post('/api/org/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'David',
        last_name: 'Newhire',
        email: empEmail,
        employee_id: `EMP-${RUN_ID}`,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');

    // Check response shape
    const emp = res.body.data.employee;
    expect(emp.email).toBe(empEmail);
    expect(emp.activation_status).toBe('PENDING_ACTIVATION');
    expect(emp.is_active).toBe(true);

    employeeId = emp.id;
    rawActivationToken = res.body.data.invite_token;
    expect(rawActivationToken).toHaveLength(64); // 32 random bytes in hex = 64 chars

    // Check onboarding object & fallback link
    const onboarding = res.body.data.invite;
    expect(onboarding.invite_link).toBeDefined();
    expect(onboarding.invite_link).toContain(`/accept-invite?token=${rawActivationToken}`);
    activationLink = onboarding.invite_link;

    // Verify in database: token_hash is SHA-256 (64 hex characters), NEVER the raw token
    const tokenRow = await db.query(
      `SELECT token_hash, used_at, expires_at FROM org_invite_tokens WHERE email = $1 AND used_at IS NULL`,
      [empEmail]
    );
    expect(tokenRow.rows).toHaveLength(1);
    const storedHash = tokenRow.rows[0].token_hash;
    expect(storedHash).not.toBe(rawActivationToken);

    const expectedHash = crypto.createHash('sha256').update(rawActivationToken).digest('hex');
    expect(storedHash).toBe(expectedHash);
  });

  it('2. Blocks login for PENDING_ACTIVATION accounts even if is_active is true', async () => {
    const loginRes = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: empEmail,
        password: 'AnyPassword@123',
      });

    expect(loginRes.status).toBe(403);
    expect(loginRes.body.message).toMatch(/activate your account/i);
  });

  it('3. Rejects tampered / modified token', async () => {
    // Flip the last character of the token
    const tampered = rawActivationToken.slice(0, -1) + (rawActivationToken.slice(-1) === 'a' ? 'b' : 'a');

    const res = await request(app)
      .post('/api/auth/activate-account')
      .send({
        token: tampered,
        password: 'SafePassword@123',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it('4. Rejects password shorter than 8 characters', async () => {
    const res = await request(app)
      .post('/api/auth/activate-account')
      .send({
        token: rawActivationToken,
        password: 'short',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 8 characters/i);
  });

  it('5. Successfully activates account: sets password, updates status to ACTIVE, marks token used', async () => {
    const res = await request(app)
      .post('/api/auth/activate-account')
      .send({
        token: rawActivationToken,
        password: 'StrongPassword@123',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.message).toMatch(/activated successfully/i);

    // Verify DB state
    const empRow = await db.query(
      `SELECT activation_status, is_active, password_hash FROM persons WHERE id = $1`,
      [employeeId]
    );
    expect(empRow.rows[0].activation_status).toBe('ACTIVE');
    expect(empRow.rows[0].is_active).toBe(true);

    // Verify token marked used
    const tokenRow = await db.query(
      `SELECT used_at FROM org_invite_tokens WHERE email = $1`,
      [empEmail]
    );
    expect(tokenRow.rows[0].used_at).not.toBeNull();
  });

  it('6. Blocks reuse of consumed token', async () => {
    const res = await request(app)
      .post('/api/auth/activate-account')
      .send({
        token: rawActivationToken,
        password: 'AnotherPassword@123',
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it('7. Allows newly activated employee to log in normally', async () => {
    const loginRes = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: empEmail,
        password: 'StrongPassword@123',
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.status).toBe('success');
    expect(loginRes.body.data.tokens.accessToken).toBeDefined();
    expect(loginRes.body.data.person.email).toBe(empEmail);
  });

  it('8. Resending invitation invalidates prior link and issues fresh one', async () => {
    // Create second employee
    const emp2Email = `emp2-${RUN_ID}@onboard.com`;
    const createRes = await request(app)
      .post('/api/org/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Eve',
        last_name: 'Second',
        email: emp2Email,
      });

    expect(createRes.status).toBe(201);
    const emp2Id = createRes.body.data.employee.id;
    const firstToken = createRes.body.data.invite_token;

    // Resend invite
    const resendRes = await request(app)
      .post(`/api/org/employees/${emp2Id}/resend-invite`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resendRes.status).toBe(200);
    const secondToken = resendRes.body.data.invite_token;
    expect(secondToken).not.toBe(firstToken);
    expect(resendRes.body.data.invite.invite_link).toContain(secondToken);

    // Old token should be rejected
    const oldAttempt = await request(app)
      .post('/api/auth/activate-account')
      .send({
        token: firstToken,
        password: 'Password@123',
      });
    expect(oldAttempt.status).toBe(400);

    // New token works
    const newAttempt = await request(app)
      .post('/api/auth/activate-account')
      .send({
        token: secondToken,
        password: 'Password@123',
      });
    expect(newAttempt.status).toBe(200);
  });

  it('9. Rejects resending invite for already-ACTIVE employee', async () => {
    const res = await request(app)
      .post(`/api/org/employees/${employeeId}/resend-invite`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already activated/i);
  });
});
