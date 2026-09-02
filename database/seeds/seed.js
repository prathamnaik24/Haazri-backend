/**
 * Seed Script — Core Structure + RBAC + Audit Log
 *
 * Seeds a minimal but realistic dataset to verify all Day 2 & Day 3
 * migrations are working correctly:
 *
 *   Day 2: organizations, departments, positions (ltree), persons, position_assignments
 *   Day 3: roles, permissions, role_permissions, person_roles, audit_logs
 *
 * Usage:
 *   npm run db:seed
 *
 * Safe to run multiple times — uses INSERT ... ON CONFLICT DO NOTHING.
 * Run AFTER: npm run db:migrate
 */

import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Client } = pg;

const clientConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'attendance_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
    };

const client = new Client(clientConfig);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const log = (msg) => console.log(`  ${msg}`);
const section = (title) => console.log(`\n── ${title} ${'─'.repeat(50 - title.length)}`);

// ─── Seed Data ────────────────────────────────────────────────────────────────

async function seed() {
  await client.connect();
  console.log('🌱 Connected to database. Starting seed...');

  try {
    await client.query('BEGIN');

    // ── 1. Organization ──────────────────────────────────────────────────────
    section('Organizations');

    const orgResult = await client.query(`
      INSERT INTO organizations (name, slug, type, is_active, metadata)
      VALUES ('Acme Corp', 'acme-corp', 'Corporate', true, '{"industry": "Technology", "country": "India"}')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name, slug
    `);
    const org = orgResult.rows[0];
    log(`✅ Org: ${org.name} (${org.slug}) — id: ${org.id}`);

    // ── 2. Departments ───────────────────────────────────────────────────────
    section('Departments');

    const deptNames = ['Engineering', 'Human Resources', 'Finance'];
    const depts = {};

    for (const name of deptNames) {
      const r = await client.query(`
        INSERT INTO departments (organization_id, name, is_active)
        VALUES ($1, $2, true)
        ON CONFLICT DO NOTHING
        RETURNING id, name
      `, [org.id, name]);

      // If conflict, fetch the existing one
      const existing = r.rows[0] || (await client.query(
        'SELECT id, name FROM departments WHERE organization_id = $1 AND name = $2',
        [org.id, name]
      )).rows[0];

      depts[name] = existing;
      log(`✅ Dept: ${existing.name} — id: ${existing.id}`);
    }

    // ── 3. Positions (ltree hierarchy) ───────────────────────────────────────
    section('Positions (ltree hierarchy)');

    /*
     * Hierarchy we're building (single root = CEO):
     *
     *   acme_corp                        ← CEO (root, parent_id IS NULL)
     *   acme_corp.cto                    ← CTO        (reports to CEO)
     *   acme_corp.hr_director            ← HR Director (reports to CEO)
     *   acme_corp.cto.senior_dev         ← Senior Developer (reports to CTO)
     *   acme_corp.cto.senior_dev.junior_dev ← Junior Developer (reports to Senior Dev)
     */
    const positionDefs = [
      { title: 'CEO',              path: 'acme_corp',                           dept: null,            parent_path: null },
      { title: 'CTO',              path: 'acme_corp.cto',                       dept: 'Engineering',   parent_path: 'acme_corp' },
      { title: 'HR Director',      path: 'acme_corp.hr_director',               dept: 'Human Resources', parent_path: 'acme_corp' },
      { title: 'Senior Developer', path: 'acme_corp.cto.senior_dev',            dept: 'Engineering',   parent_path: 'acme_corp.cto' },
      { title: 'Junior Developer', path: 'acme_corp.cto.senior_dev.junior_dev', dept: 'Engineering',   parent_path: 'acme_corp.cto.senior_dev' },
    ];

    const positions = {};

    for (const def of positionDefs) {
      const deptId = def.dept ? depts[def.dept]?.id : null;

      // Resolve parent_id from the path we already inserted
      const parentId = def.parent_path ? positions[def.parent_path]?.id : null;

      // Guard against duplicate roots: if this is a root position check first
      if (!def.parent_path) {
        const existingRoot = await client.query(
          'SELECT id, title, path FROM positions WHERE organization_id = $1 AND parent_id IS NULL AND is_active = true ORDER BY created_at ASC LIMIT 1',
          [org.id]
        );
        if (existingRoot.rows.length > 0) {
          // A root already exists — use it instead of inserting a duplicate
          positions[def.path] = existingRoot.rows[0];
          log(`ℹ️  Root already exists: ${existingRoot.rows[0].title.padEnd(20)} path: ${existingRoot.rows[0].path}`);
          continue;
        }
      }

      const r = await client.query(`
        INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
        VALUES ($1, $2, $3, $4, $5::ltree, true)
        ON CONFLICT DO NOTHING
        RETURNING id, title, path
      `, [org.id, deptId, parentId, def.title, def.path]);

      const existing = r.rows[0] || (await client.query(
        'SELECT id, title, path FROM positions WHERE organization_id = $1 AND path = $2::ltree',
        [org.id, def.path]
      )).rows[0];

      positions[def.path] = existing;
      log(`✅ Position: ${existing.title.padEnd(20)} path: ${existing.path}`);
    }


    // ── 4. Persons (Admin & Employees) ───────────────────────────────────────
    section('Persons');

    await client.query("CREATE SEQUENCE IF NOT EXISTS workday_id_seq START WITH 1 INCREMENT BY 1");
    await client.query("ALTER TABLE persons ADD COLUMN IF NOT EXISTS workday_id VARCHAR(50)");

    const adminHash = await bcrypt.hash('Admin@1234', 12);
    const userHash = await bcrypt.hash('Password@1234', 12);

    const peopleDefs = [
      { first_name: 'John',   last_name: 'Admin',  email: 'john.admin@acme-corp.com', employee_id: 'EMP-001', password_hash: adminHash, position: 'acme_corp',                  role: 'Org Admin' },
      { first_name: 'Rohan',  last_name: 'Sharma', email: 'rohan@acme-corp.com',      employee_id: 'EMP-002', password_hash: userHash,  position: 'acme_corp.hr_director.senior_dev', role: 'Employee' },
      { first_name: 'Ayesha', last_name: 'Khan',   email: 'ayesha@acme-corp.com',     employee_id: 'EMP-003', password_hash: userHash,  position: 'acme_corp.hr_director',         role: 'HR Manager' },
    ];

    const seededPeople = [];

    for (const def of peopleDefs) {
      const res = await client.query(`
        INSERT INTO persons (organization_id, first_name, last_name, email, employee_id, password_hash, workday_id, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, 'WD-' || LPAD(nextval('workday_id_seq')::text, 6, '0'), true)
        ON CONFLICT (organization_id, email) DO UPDATE SET employee_id = EXCLUDED.employee_id, password_hash = EXCLUDED.password_hash
        RETURNING id, first_name, last_name, email, employee_id, workday_id
      `, [org.id, def.first_name, def.last_name, def.email, def.employee_id, def.password_hash]);

      const person = res.rows[0];
      seededPeople.push({ ...person, position: def.position, role: def.role });
      log(`✅ Person: ${person.first_name} ${person.last_name} (${person.email}) — ID: ${person.employee_id}`);
    }

    // ── 5. Position Assignment ───────────────────────────────────────────────
    section('Position Assignments');

    for (const p of seededPeople) {
      if (p.position && positions[p.position]) {
        await client.query(`
          INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
          VALUES ($1, $2, true, current_date)
          ON CONFLICT DO NOTHING
        `, [p.id, positions[p.position].id]);
        log(`✅ Assigned ${p.first_name} ${p.last_name} → ${p.position} position`);
      }
    }

    // ── 6. Roles ─────────────────────────────────────────────────────────────
    section('Roles');

    const roleDefs = ['Org Admin', 'CEO', 'HR Manager', 'Employee'];
    const roles = {};

    for (const name of roleDefs) {
      const r = await client.query(`
        INSERT INTO roles (organization_id, name)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        RETURNING id, name
      `, [org.id, name]);

      const existing = r.rows[0] || (await client.query(
        'SELECT id, name FROM roles WHERE organization_id = $1 AND name = $2',
        [org.id, name]
      )).rows[0];

      roles[name] = existing;
      log(`✅ Role: ${existing.name}`);
    }

    // ── 7. Permissions ───────────────────────────────────────────────────────
    section('Permissions');

    const permDefs = [
      { name: 'manage_org',        description: 'Can manage organization settings' },
      { name: 'manage_roles',      description: 'Can create and assign roles' },
      { name: 'manage_employees',  description: 'Can create, update, deactivate employees' },
      { name: 'view_attendance',   description: 'Can view attendance records' },
      { name: 'manage_attendance', description: 'Can edit and correct attendance records' },
      { name: 'approve_leaves',    description: 'Can approve or reject leave requests' },
      { name: 'view_payroll',      description: 'Can view payroll data' },
      { name: 'finance:read',      description: 'Can view organization financial summary and reports' },
      { name: 'finance:write',     description: 'Can modify financial settings and records' },
      { name: 'billing:read',      description: 'Can view billing and subscription details' },
      { name: 'billing:write',     description: 'Can update billing information' },
      { name: 'subscription:manage', description: 'Can change organization subscription plan' },
    ];

    const perms = {};

    for (const def of permDefs) {
      const r = await client.query(`
        INSERT INTO permissions (name, description)
        VALUES ($1, $2)
        ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
        RETURNING id, name
      `, [def.name, def.description]);

      perms[def.name] = r.rows[0];
      log(`✅ Permission: ${r.rows[0].name}`);
    }

    // ── 8. Role ↔ Permission mappings ─────────────────────────────────────
    section('Role-Permission Mappings');

    const rolePermMap = {
      'Org Admin':  ['manage_org', 'manage_roles', 'manage_employees', 'view_attendance', 'manage_attendance', 'approve_leaves', 'view_payroll', 'finance:read', 'finance:write', 'billing:read', 'billing:write', 'subscription:manage'],
      'CEO':        ['manage_org', 'view_attendance', 'view_payroll', 'finance:read', 'billing:read', 'subscription:manage'],
      'HR Manager': ['manage_employees', 'view_attendance', 'approve_leaves'],
      'Employee':   ['view_attendance'],
    };

    for (const [roleName, permNames] of Object.entries(rolePermMap)) {
      for (const permName of permNames) {
        await client.query(`
          INSERT INTO role_permissions (role_id, permission_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [roles[roleName].id, perms[permName].id]);
      }
      log(`✅ ${roleName.padEnd(15)} → [${permNames.join(', ')}]`);
    }

    // ── 8.5 Subscription Plans & Org Subscription ──────────────────────────────
    section('Subscriptions');

    const subPlans = [
      { name: 'Starter', slug: 'starter', max_employees: 50, price_cents: 0, metadata: JSON.stringify({ features: ['basic_attendance', 'basic_leaves'] }) },
      { name: 'Growth', slug: 'growth', max_employees: 100, price_cents: 0, metadata: JSON.stringify({ features: ['basic_attendance', 'basic_leaves', 'financial_dashboard', 'billing_portal', 'subscription_management'] }) },
    ];

    for (const p of subPlans) {
      await client.query(`
        INSERT INTO subscription_plans (name, slug, max_employees, price_cents, metadata)
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (slug) DO UPDATE
        SET name = EXCLUDED.name, max_employees = EXCLUDED.max_employees, price_cents = EXCLUDED.price_cents, metadata = EXCLUDED.metadata
      `, [p.name, p.slug, p.max_employees, p.price_cents, p.metadata]);
    }

    const growthPlanRes = await client.query('SELECT id FROM subscription_plans WHERE slug = $1', ['growth']);
    if (growthPlanRes.rows.length > 0) {
      const growthPlanId = growthPlanRes.rows[0].id;
      await client.query(`
        INSERT INTO organization_subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
        VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '1 year')
        ON CONFLICT (organization_id) DO NOTHING
      `, [org.id, growthPlanId]);
      log(`✅ Org Subscription: Active Growth plan assigned to ${org.name}`);
    }

    // ── 9. Assign Roles to Persons ───────────────────────────────────────────
    section('Person Roles');

    for (const p of seededPeople) {
      if (p.role && roles[p.role]) {
        await client.query(`
          INSERT INTO person_roles (person_id, role_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [p.id, roles[p.role].id]);
        log(`✅ Assigned role ${p.role} → ${p.first_name} ${p.last_name}`);
      }
    }
    // ── 9.5 Leave Types & Policies ──────────────────────────────────────────
    section('Leave Types & Policies');

    const leaveTypeDefs = [
      { name: 'Annual Leave', days: 10.0, is_paid: true },
      { name: 'Sick Leave',   days: 7.0,  is_paid: true },
      { name: 'Casual Leave', days: 5.0,  is_paid: true },
    ];

    for (const def of leaveTypeDefs) {
      let leaveType;
      const existingRes = await client.query(
        'SELECT id, name FROM leave_types WHERE organization_id = $1 AND name = $2',
        [org.id, def.name]
      );
      if (existingRes.rows.length > 0) {
        leaveType = existingRes.rows[0];
      } else {
        const insertRes = await client.query(`
          INSERT INTO leave_types (organization_id, name, is_paid, is_active)
          VALUES ($1, $2, $3, true)
          RETURNING id, name
        `, [org.id, def.name, def.is_paid]);
        leaveType = insertRes.rows[0];
      }

      // Check if policy exists
      const existingPolicy = await client.query(
        'SELECT id FROM leave_policies WHERE leave_type_id = $1',
        [leaveType.id]
      );
      if (existingPolicy.rows.length === 0) {
        await client.query(`
          INSERT INTO leave_policies (leave_type_id, days_allowed, carry_forward_allowed)
          VALUES ($1, $2, false)
        `, [leaveType.id, def.days]);
      }
      log(`✅ Leave Type: ${leaveType.name} (Policy: ${def.days} days)`);
    }
    // ── 9.8 Compensation, Salary Components & Payroll ────────────────────────
    section('Compensation & Payroll');

    const ayesha = seededPeople.find(p => p.email === 'ayesha@acme-corp.com');
    if (ayesha) {
      // 1. Base salary structure
      await client.query(`
        INSERT INTO salary_structures (person_id, base_salary, allowances, is_active, effective_from)
        VALUES ($1, 50000.00, 5000.00, true, current_date)
        ON CONFLICT DO NOTHING
      `, [ayesha.id]);

      // 2. Salary components
      const sampleComponents = [
        { type: 'BASIC', calc: 'FIXED', base: null, val: 25000, amt: 25000 },
        { type: 'HRA', calc: 'PERCENTAGE', base: 'BASIC', val: 25.00, amt: 12500 },
        { type: 'STANDARD_ALLOWANCE', calc: 'FIXED', base: null, val: 3000, amt: 3000 },
        { type: 'PERFORMANCE_BONUS', calc: 'FIXED', base: null, val: 5000, amt: 5000 },
        { type: 'LTA', calc: 'FIXED', base: null, val: 5000, amt: 5000 },
        { type: 'FIXED_ALLOWANCE', calc: 'FIXED', base: null, val: 2000, amt: 2000 },
      ];

      for (const comp of sampleComponents) {
        const existingComp = await client.query(
          'SELECT id FROM salary_components WHERE person_id = $1 AND component_type = $2',
          [ayesha.id, comp.type]
        );
        if (existingComp.rows.length === 0) {
          await client.query(`
            INSERT INTO salary_components (person_id, component_type, calculation_type, percentage_base, configured_value, calculated_amount, is_active, effective_from)
            VALUES ($1, $2, $3, $4, $5, $6, true, current_date)
          `, [ayesha.id, comp.type, comp.calc, comp.base, comp.val, comp.amt]);
        }
      }

      // 3. Current month payroll record for September 2026
      const existingPayroll = await client.query(
        'SELECT id FROM payroll WHERE person_id = $1 AND year = 2026 AND month = 9',
        [ayesha.id]
      );
      if (existingPayroll.rows.length === 0) {
        await client.query(`
          INSERT INTO payroll (
            person_id, year, month, total_earnings, total_deductions, net_salary, status,
            basic_salary, hra, standard_allowance, performance_bonus, leave_travel_allowance, fixed_allowance, stock_equity,
            tds, provident_fund, professional_tax, other_deductions, working_days, paid_days
          ) VALUES (
            $1, 2026, 9, 52500.00, 6200.00, 46300.00, 'Pending',
            25000.00, 12500.00, 3000.00, 5000.00, 5000.00, 2000.00, 0.00,
            3000.00, 3000.00, 200.00, 0.00, 22, 22
          )
        `, [ayesha.id]);
      }
      log(`✅ Compensation & Payroll seeded for Ayesha Khan`);
    }

    // ── 10. Sample Audit Log ──────────────────────────────────────────────────
    section('Audit Log (sample row)');

    const adminPerson = seededPeople.find(p => p.email === 'john.admin@acme-corp.com');

    await client.query(`
      INSERT INTO audit_logs (
        organization_id, entity_type, entity_id, action,
        old_data, new_data, changed_by, reason
      ) VALUES (
        $1, 'organization', $2, 'SEED',
        NULL,
        $3::jsonb,
        $4,
        'Initial seed script — development environment setup'
      )
    `, [
      org.id,
      org.id,
      JSON.stringify({
        name: org.name,
        slug: org.slug,
        seeded_at: new Date().toISOString(),
      }),
      adminPerson.id,
    ]);

    log(`✅ Audit log entry inserted (action: SEED)`);

    // ─────────────────────────────────────────────────────────────────────────
    await client.query('COMMIT');

    console.log(`
╔══════════════════════════════════════════════════════╗
║  ✅  Seed complete! Summary:                         ║
║                                                      ║
║  Org:      Acme Corp  (slug: acme-corp)              ║
║  Depts:    Engineering, Human Resources, Finance     ║
║  Position: CEO → CTO → Senior Dev / Junior Dev       ║
║            CEO → HR Director                         ║
║  Person:   john.admin@acme-corp.com                  ║
║  Password: Admin@1234   (change in production!)      ║
║  Role:     Org Admin (all permissions)               ║
║  Audit:    1 SEED entry in audit_logs                ║
╚══════════════════════════════════════════════════════╝
`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Seed failed — transaction rolled back.');
    console.error(err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
