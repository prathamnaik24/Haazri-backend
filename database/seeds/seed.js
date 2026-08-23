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

require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'attendance_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

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
     * Hierarchy we're building:
     *
     *   acme_corp                    ← CEO
     *   acme_corp.cto                ← CTO   (reports to CEO)
     *   acme_corp.hr_director        ← HR Director (reports to CEO)
     *   acme_corp.cto.senior_dev     ← Senior Developer (reports to CTO)
     *   acme_corp.cto.junior_dev     ← Junior Developer (reports to CTO)
     */
    const positionDefs = [
      { title: 'CEO',               path: 'acme_corp',                      dept: null,                  parent_path: null },
      { title: 'CTO',               path: 'acme_corp.cto',                  dept: 'Engineering',         parent_path: 'acme_corp' },
      { title: 'HR Director',       path: 'acme_corp.hr_director',          dept: 'Human Resources',     parent_path: 'acme_corp' },
      { title: 'Senior Developer',  path: 'acme_corp.hr_director.senior_dev', dept: 'Engineering',       parent_path: 'acme_corp.hr_director' },
      { title: 'Junior Developer',  path: 'acme_corp.cto.junior_dev',       dept: 'Engineering',         parent_path: 'acme_corp.cto' },
    ];

    const positions = {};

    for (const def of positionDefs) {
      const deptId = def.dept ? depts[def.dept]?.id : null;

      // Resolve parent_id from the path we already inserted
      const parentId = def.parent_path ? positions[def.parent_path]?.id : null;

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
        INSERT INTO persons (organization_id, first_name, last_name, email, employee_id, password_hash, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (organization_id, email) DO UPDATE SET employee_id = EXCLUDED.employee_id, password_hash = EXCLUDED.password_hash
        RETURNING id, first_name, last_name, email, employee_id
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

    const roleDefs = ['Org Admin', 'HR Manager', 'Employee'];
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
      'Org Admin':  ['manage_org', 'manage_roles', 'manage_employees', 'view_attendance', 'manage_attendance', 'approve_leaves', 'view_payroll'],
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
