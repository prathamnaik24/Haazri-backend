import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { db } from '../src/db/index.js';
import { closePool } from '../src/config/db.js';
import bcrypt from 'bcryptjs';
import { numberToWords } from '../src/utils/numberToWords.js';

const RUN_ID = Date.now();
const TEST_ORG = {
  org_name: 'Payroll Automation Corp',
  org_slug: `payroll-corp-${RUN_ID}`,
  org_type: 'Corporate',
  admin_first_name: 'Payroll',
  admin_last_name: 'Admin',
  admin_email: `admin-${RUN_ID}@payrollcorp.com`,
  admin_password: 'TestPass@123',
};

let adminToken = '';
let employeeToken = '';
let otherEmployeeToken = '';

let orgId = '';
let adminId = '';
let employeeId = '';
let otherEmployeeId = '';
let createdPayrollId = '';
let createdPayslipId = '';
let leaveTypeId = '';

afterAll(async () => {
  await closePool();
});

describe('Automatic Payroll & Payslip System Tests', () => {
  beforeAll(async () => {
    // 1. Register organization & obtain Admin token
    const regRes = await request(app)
      .post('/api/auth/org/register')
      .send(TEST_ORG);

    expect(regRes.status).toBe(201);
    adminToken = regRes.body.data.tokens.accessToken;
    orgId = regRes.body.data.organization.id;
    adminId = regRes.body.data.person.id;

    // 2. Create Leave Type (Paid)
    const ltRes = await db.query(
      `INSERT INTO leave_types (organization_id, name, is_paid, is_active)
       VALUES ($1, 'Paid Annual Leave', true, true)
       RETURNING id`,
      [orgId]
    );
    leaveTypeId = ltRes.rows[0].id;

    // 3. Create Employee 1 with bank details
    const passwordHash = await bcrypt.hash('EmployeePass@123', 12);
    const empRes = await db.query(
      `INSERT INTO persons (
         organization_id, first_name, last_name, email, password_hash, employee_id, workday_id,
         bank_name, account_number, ifsc_code, pan_number, is_active
       ) VALUES ($1, 'John', 'Doe', $2, $3, $4, $5, 'HDFC Bank', '123456789012', 'HDFC0001234', 'ABCDE1234F', true)
       RETURNING id`,
      [
        orgId,
        `john.doe.${RUN_ID}@payrollcorp.com`,
        passwordHash,
        `EMP-${RUN_ID}`,
        `WD-${RUN_ID}`,
      ]
    );
    employeeId = empRes.rows[0].id;

    // Create Employee 2 (for attendance/leave & IDOR testing)
    const emp2Res = await db.query(
      `INSERT INTO persons (
         organization_id, first_name, last_name, email, password_hash, employee_id, workday_id, is_active
       ) VALUES ($1, 'Jane', 'Smith', $2, $3, $4, $5, true)
       RETURNING id`,
      [
        orgId,
        `jane.smith.${RUN_ID}@payrollcorp.com`,
        passwordHash,
        `EMP2-${RUN_ID}`,
        `WD2-${RUN_ID}`,
      ]
    );
    otherEmployeeId = emp2Res.rows[0].id;

    // Log in Employee 1
    const empLogin = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: `john.doe.${RUN_ID}@payrollcorp.com`,
        password: 'EmployeePass@123',
      });
    expect(empLogin.status).toBe(200);
    employeeToken = empLogin.body.data.tokens.accessToken;

    // Log in Employee 2
    const emp2Login = await request(app)
      .post('/api/auth/employee/login')
      .send({
        org_slug: TEST_ORG.org_slug,
        email: `jane.smith.${RUN_ID}@payrollcorp.com`,
        password: 'EmployeePass@123',
      });
    expect(emp2Login.status).toBe(200);
    otherEmployeeToken = emp2Login.body.data.tokens.accessToken;

    // Set base salary structure for Employee 1 (Base: ₹60,000, Allowances: ₹5,000)
    await request(app)
      .post(`/api/compensation/person/${employeeId}/structure`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        base_salary: 60000,
        allowances: 5000,
        effective_from: '2026-01-01',
      });

    // Add HRA component (20% of Basic = ₹12,000)
    await request(app)
      .post(`/api/compensation/person/${employeeId}/components`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        component_type: 'HRA',
        calculation_type: 'PERCENTAGE',
        percentage_base: 'BASIC',
        configured_value: 20,
      });

    // Mark 30 days attendance for Employee 1 in Sept 2026
    for (let day = 1; day <= 30; day++) {
      const dayStr = String(day).padStart(2, '0');
      await db.query(
        `INSERT INTO attendance (person_id, work_date, status, punctuality_status)
         VALUES ($1, $2, 'Present', 'ON_TIME')`,
        [employeeId, `2026-09-${dayStr}`]
      );
    }
  });

  // ----------------------------------------------------
  // UTILITY TEST: numberToWords
  // ----------------------------------------------------
  it('converts numbers to Indian Rupee words correctly', () => {
    expect(numberToWords(79700)).toBe('Rupees Seventy-Nine Thousand Seven Hundred Only');
    expect(numberToWords(77000.50)).toBe('Rupees Seventy-Seven Thousand and Fifty Paise Only');
    expect(numberToWords(0)).toBe('Rupees Zero Only');
  });

  // ----------------------------------------------------
  // AUTHORIZATION TESTS: Employee Restrictions
  // ----------------------------------------------------
  it('prevents an employee from generating payroll (403 Forbidden)', async () => {
    const res = await request(app)
      .post('/api/payroll/generate')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        person_id: employeeId,
        month: 9,
        year: 2026,
      });

    expect(res.status).toBe(403);
  });

  it('prevents an employee from modifying salary structures (403 Forbidden)', async () => {
    const res = await request(app)
      .post(`/api/compensation/person/${employeeId}/structure`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        base_salary: 90000,
      });

    expect(res.status).toBe(403);
  });

  // ----------------------------------------------------
  // PAYROLL GENERATION & AUTOMATIC CALCULATION TESTS
  // ----------------------------------------------------
  it('allows Admin to automatically generate payroll with ONLY { person_id, month, year }', async () => {
    const res = await request(app)
      .post('/api/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: employeeId,
        month: 9,
        year: 2026,
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.person_id).toBe(employeeId);
    expect(res.body.data.month).toBe(9);
    expect(res.body.data.year).toBe(2026);
    expect(res.body.data.working_days).toBe(30);
    expect(res.body.data.paid_days).toBe(30);
    expect(Number(res.body.data.basic_salary)).toBe(60000);
    expect(Number(res.body.data.hra)).toBe(12000);
    expect(Number(res.body.data.fixed_allowance)).toBe(5000);
    expect(Number(res.body.data.total_earnings)).toBe(77000);
    expect(res.body.data).toHaveProperty('amount_in_words');
    expect(res.body.data.amount_in_words).toBe('Rupees Seventy-Seven Thousand Only');

    createdPayrollId = res.body.data.id;
  });

  it('safely regenerates/updates existing payroll without duplicate record errors', async () => {
    const res = await request(app)
      .post('/api/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: employeeId,
        month: 9,
        year: 2026,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(createdPayrollId);
  });

  it('calculates payable days from attendance and approved paid leave, prorating salary accordingly', async () => {
    // Set base salary for Employee 2: ₹30,000
    await request(app)
      .post(`/api/compensation/person/${otherEmployeeId}/structure`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        base_salary: 30000,
        allowances: 0,
        effective_from: '2026-01-01',
      });

    // Log 15 days attendance in Sept 2026
    for (let day = 1; day <= 15; day++) {
      const dayStr = String(day).padStart(2, '0');
      await db.query(
        `INSERT INTO attendance (person_id, work_date, status, punctuality_status)
         VALUES ($1, $2, 'Present', 'ON_TIME')`,
        [otherEmployeeId, `2026-09-${dayStr}`]
      );
    }

    // Add approved paid leave from Sept 16 to Sept 20 (5 days)
    await db.query(
      `INSERT INTO leave_requests (person_id, leave_type_id, start_date, end_date, status)
       VALUES ($1, $2, '2026-09-16', '2026-09-20', 'Approved')`,
      [otherEmployeeId, leaveTypeId]
    );

    // Generate payroll for Sept 2026
    const res = await request(app)
      .post('/api/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: otherEmployeeId,
        month: 9,
        year: 2026,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.working_days).toBe(30);
    // Paid days = 15 attendance + 5 paid leave = 20 paid days
    expect(res.body.data.paid_days).toBe(20);
    // Prorated salary = 30000 * (20 / 30) = 20000
    expect(Number(res.body.data.basic_salary)).toBe(20000);
    expect(Number(res.body.data.total_earnings)).toBe(20000);
    expect(Number(res.body.data.net_salary)).toBe(20000);
  });

  it('handles cross-month overlapping leaves correctly', async () => {
    // Add approved paid leave from Sept 28 to Oct 5 (overlaps 3 days in Sept: 28, 29, 30)
    await db.query(
      `INSERT INTO leave_requests (person_id, leave_type_id, start_date, end_date, status)
       VALUES ($1, $2, '2026-09-28', '2026-10-05', 'Approved')`,
      [otherEmployeeId, leaveTypeId]
    );

    // Generate payroll for Sept 2026 again
    const resSept = await request(app)
      .post('/api/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: otherEmployeeId,
        month: 9,
        year: 2026,
      });

    expect(resSept.status).toBe(201);
    // Sept paid days = 15 attendance + 5 paid leave + 3 cross-month leave days = 23 paid days
    expect(resSept.body.data.paid_days).toBe(23);
    // Prorated salary = 30000 * (23 / 30) = 23000
    expect(Number(resSept.body.data.basic_salary)).toBe(23000);

    // Generate payroll for Oct 2026 (31 days in Oct, 5 overlapping leave days in Oct: Oct 1 to Oct 5)
    const resOct = await request(app)
      .post('/api/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: otherEmployeeId,
        month: 10,
        year: 2026,
      });

    expect(resOct.status).toBe(201);
    expect(resOct.body.data.working_days).toBe(31);
    // Oct paid days = 5 overlapping leave days
    expect(resOct.body.data.paid_days).toBe(5);
    // Prorated salary = 30000 * (5 / 31) = 4838.71
    expect(Number(resOct.body.data.basic_salary)).toBe(4838.71);
  });

  it('calculates 0 paid days and ₹0 net salary when employee has zero attendance and zero leaves', async () => {
    // Generate payroll for November 2026 (0 attendance, 0 leaves, 0 holidays)
    const resNov = await request(app)
      .post('/api/payroll/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        person_id: otherEmployeeId,
        month: 11,
        year: 2026,
      });

    expect(resNov.status).toBe(201);
    expect(resNov.body.data.working_days).toBe(30);
    expect(resNov.body.data.paid_days).toBe(0);
    expect(Number(resNov.body.data.total_earnings)).toBe(0);
    expect(Number(resNov.body.data.net_salary)).toBe(0);
    expect(resNov.body.data.amount_in_words).toBe('Rupees Zero Only');
  });

  // ----------------------------------------------------
  // PAYSLIP & IDOR SECURITY TESTS
  // ----------------------------------------------------
  it('allows employee to retrieve their own payslip list', async () => {
    const res = await request(app)
      .get('/api/payroll/payslips/me')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    createdPayslipId = res.body.data[0].id;
  });

  it('allows employee to view their own detailed payslip (with masked bank account)', async () => {
    const res = await request(app)
      .get(`/api/payroll/payslips/${createdPayslipId}`)
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.employee.id).toBe(employeeId);
    expect(res.body.data.bank.bank_name).toBe('HDFC Bank');
    expect(res.body.data.bank.masked_account_number).toBe('XXXX XXXX 9012');
    expect(res.body.data.bank.ifsc_code).toBe('HDFC0001234');
    expect(res.body.data.bank.pan_number).toBe('ABCDE1234F');
    expect(res.body.data.payroll.net_salary).toBe(77000);
    expect(res.body.data.payroll.amount_in_words).toBe('Rupees Seventy-Seven Thousand Only');
  });

  it('allows employee to download their own payslip PDF', async () => {
    const res = await request(app)
      .get(`/api/payroll/payslips/${createdPayslipId}/pdf`)
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body).toBeInstanceOf(Buffer);
    const pdfMagic = res.body.toString('ascii', 0, 4);
    expect(pdfMagic).toBe('%PDF');
  });

  it('blocks employee from viewing another employee\'s payslip (403 Forbidden)', async () => {
    const res = await request(app)
      .get(`/api/payroll/payslips/${createdPayslipId}`)
      .set('Authorization', `Bearer ${otherEmployeeToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('Forbidden');
  });

  it('blocks employee from downloading another employee\'s payslip PDF (403 Forbidden)', async () => {
    const res = await request(app)
      .get(`/api/payroll/payslips/${createdPayslipId}/pdf`)
      .set('Authorization', `Bearer ${otherEmployeeToken}`);

    expect(res.status).toBe(403);
  });
});
