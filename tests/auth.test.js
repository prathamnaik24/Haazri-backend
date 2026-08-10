/**
 * Auth Tests — Day 4 & Day 5
 *
 * Integration tests using Supertest against the real Express app
 * and the real running database (Docker must be up).
 *
 * Covers:
 *   Day 4: POST /api/auth/org/register
 *           POST /api/auth/org/login
 *   Day 5: POST /api/auth/employee/login
 *           GET  /api/auth/me
 *
 * Each test run generates a unique org slug + email via Date.now()
 * so tests never collide with each other or with seed data.
 *
 * Run with: npm test  (from backend/ directory)
 *       or: npm run test  (from root — delegates to backend)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { closePool } from '../src/config/db.js';

// ─── Shared test state ────────────────────────────────────────────────────────
// Using a timestamp suffix so every test run is isolated
const RUN_ID = Date.now();
const TEST_ORG = {
  org_name:           'Test Corp',
  org_slug:           `test-corp-${RUN_ID}`,
  org_type:           'Corporate',
  admin_first_name:   'Test',
  admin_last_name:    'Admin',
  admin_email:        `admin-${RUN_ID}@testcorp.com`,
  admin_password:     'TestPass@123',
};

// Seed org (created by npm run db:seed) — stable credentials for employee tests
const SEED_ORG_SLUG   = 'acme-corp';
const SEED_EMAIL      = 'john.admin@acme-corp.com';
const SEED_PASSWORD   = 'Admin@1234';

let orgAdminToken = '';  // shared across org login tests

// ─── Cleanup ──────────────────────────────────────────────────────────────────
afterAll(async () => {
  await closePool();
});

// ═════════════════════════════════════════════════════════════════════════════
// DAY 4 — Org Registration & Login
// ═════════════════════════════════════════════════════════════════════════════

describe('DAY 4 — POST /api/auth/org/register', () => {

  it('should register a new org and return 201 with tokens', async () => {
    const res = await request(app)
      .post('/api/auth/org/register')
      .send(TEST_ORG);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');

    // Organization shape
    expect(res.body.data.organization).toMatchObject({
      name: TEST_ORG.org_name,
      slug: TEST_ORG.org_slug,
    });

    // Person shape
    expect(res.body.data.person).toMatchObject({
      email: TEST_ORG.admin_email,
      first_name: TEST_ORG.admin_first_name,
    });

    // JWT tokens present
    expect(res.body.data.tokens.accessToken).toBeDefined();
    expect(res.body.data.tokens.refreshToken).toBeDefined();
    expect(typeof res.body.data.tokens.accessToken).toBe('string');
  });

  it('should reject duplicate org slug with 409', async () => {
    // Try to register the same org again
    const res = await request(app)
      .post('/api/auth/org/register')
      .send(TEST_ORG);

    expect(res.status).toBe(409);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toMatch(/already taken/i);
  });

  it('should reject missing required fields with 400', async () => {
    const res = await request(app)
      .post('/api/auth/org/register')
      .send({ org_name: 'Incomplete Corp' }); // missing all other required fields

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
  });

  it('should reject a weak password (< 8 chars) with 400', async () => {
    const res = await request(app)
      .post('/api/auth/org/register')
      .send({ ...TEST_ORG, org_slug: `another-${RUN_ID}`, admin_password: '123' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 8 characters/i);
  });

  it('should reject an invalid email format with 400', async () => {
    const res = await request(app)
      .post('/api/auth/org/register')
      .send({ ...TEST_ORG, org_slug: `email-test-${RUN_ID}`, admin_email: 'notanemail' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid email/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────

describe('DAY 4 — POST /api/auth/org/login', () => {

  it('should log in with seed org credentials and return 200 with token', async () => {
    const res = await request(app)
      .post('/api/auth/org/login')
      .send({
        org_slug: SEED_ORG_SLUG,
        email:    SEED_EMAIL,
        password: SEED_PASSWORD,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    // Person shape
    expect(res.body.data.person.email).toBe(SEED_EMAIL);
    expect(res.body.data.person.org_slug).toBe(SEED_ORG_SLUG);

    // Roles
    expect(Array.isArray(res.body.data.roles)).toBe(true);
    expect(res.body.data.roles).toContain('Org Admin');

    // Tokens
    expect(res.body.data.tokens.accessToken).toBeDefined();

    // Save for /me test
    orgAdminToken = res.body.data.tokens.accessToken;
  });

  it('should reject wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/org/login')
      .send({
        org_slug: SEED_ORG_SLUG,
        email:    SEED_EMAIL,
        password: 'WrongPassword!',
      });

    expect(res.status).toBe(401);
    expect(res.body.status).toBe('error');
  });

  it('should reject non-existent org slug with 401', async () => {
    const res = await request(app)
      .post('/api/auth/org/login')
      .send({
        org_slug: 'does-not-exist-org',
        email:    SEED_EMAIL,
        password: SEED_PASSWORD,
      });

    expect(res.status).toBe(401);
  });

  it('should reject missing org_slug with 400', async () => {
    const res = await request(app)
      .post('/api/auth/org/login')
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });

    expect(res.status).toBe(400);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// DAY 5 — Employee Login + Position Path
// ═════════════════════════════════════════════════════════════════════════════

describe('DAY 5 — POST /api/auth/employee/login', () => {

  it('should log in as employee and return 200 with position_path in token', async () => {
    const res = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: SEED_ORG_SLUG,
        email:    SEED_EMAIL,
        password: SEED_PASSWORD,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');

    const { person, roles, tokens } = res.body.data;

    // Person shape
    expect(person.email).toBe(SEED_EMAIL);
    expect(person.organization.slug).toBe(SEED_ORG_SLUG);

    // Position — seed assigned John Admin as CEO (path: acme_corp)
    expect(person.primary_position).not.toBeNull();
    expect(person.primary_position.path).toBe('acme_corp');
    expect(person.primary_position.title).toBe('CEO');

    // Roles
    expect(Array.isArray(roles)).toBe(true);

    // Token
    expect(tokens.accessToken).toBeDefined();
  });

  it('should reject wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: SEED_ORG_SLUG,
        email:    SEED_EMAIL,
        password: 'BadPassword!',
      });

    expect(res.status).toBe(401);
  });

  it('should reject unknown email within org with 401', async () => {
    const res = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: SEED_ORG_SLUG,
        email:    'ghost@acme-corp.com',
        password: SEED_PASSWORD,
      });

    expect(res.status).toBe(401);
  });

  it('should reject missing org_slug with 400', async () => {
    const res = await request(app)
      .post('/api/auth/employee/login')
      .send({ email: SEED_EMAIL, password: SEED_PASSWORD });

    expect(res.status).toBe(400);
  });

});

// ═════════════════════════════════════════════════════════════════════════════
// DAY 5 — Protected Endpoint: GET /api/auth/me
// ═════════════════════════════════════════════════════════════════════════════

describe('DAY 5 — GET /api/auth/me', () => {

  it('should return decoded token data when authenticated', async () => {
    // Use the token saved from org login test above
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${orgAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.user.person_id).toBeDefined();
    expect(res.body.data.user.organization_id).toBeDefined();
    expect(res.body.data.user.type).toBe('org_admin');
  });

  it('should return 401 when no token is provided', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('should return 401 when token is malformed', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer this.is.not.a.real.token');

    expect(res.status).toBe(401);
  });

  it('should return 401 when Authorization header is missing Bearer prefix', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', orgAdminToken); // no "Bearer " prefix

    expect(res.status).toBe(401);
  });

});
