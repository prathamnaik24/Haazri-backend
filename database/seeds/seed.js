/**
 * Seed Script — expanded Acme Corp development dataset.
 *
 * Important fixture contract:
 * - Production organization creation does not auto-assign the creator as CEO.
 * - The Acme Corp development fixture explicitly assigns John Admin to the CEO position
 *   at path acme_corp so tests and the seeded org hierarchy remain consistent.
 * - This is fixture data only; it does not change production org-creation behavior.
 *
 * Safe to run multiple times and preserves the repo's current single-root hierarchy
 * constraints, Org Admin / HR Manager / Employee roles, and existing payroll data.
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

const log = (msg) => console.log(`  ${msg}`);
const section = (title) => console.log(`\n── ${title} ${'─'.repeat(50 - title.length)}`);

const BUILD_ROOT_PATH = 'acme_corp';
const DEFAULT_PASSWORD_HASH = bcrypt.hashSync('Password@1234', 12);

async function ensureWorkdaySupport() {
  await client.query("CREATE SEQUENCE IF NOT EXISTS workday_id_seq START WITH 1 INCREMENT BY 1");
  await client.query("ALTER TABLE persons ADD COLUMN IF NOT EXISTS workday_id VARCHAR(50)");
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'persons_workday_id_unique'
      ) THEN
        ALTER TABLE persons ADD CONSTRAINT persons_workday_id_unique UNIQUE (workday_id);
      END IF;
    END $$;
  `);
}

async function ensureOrg() {
  const result = await client.query(`
    INSERT INTO organizations (name, slug, type, is_active, metadata)
    VALUES ('Acme Corp', 'acme-corp', 'Corporate', true, '{"industry":"Technology","country":"India"}')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name, slug
  `);

  return result.rows[0];
}

async function ensureDepartment(orgId, name) {
  const existing = await client.query(
    `SELECT id, name FROM departments WHERE organization_id = $1 AND name = $2`,
    [orgId, name]
  );

  if (existing.rows[0]) return existing.rows[0];

  const result = await client.query(
    `INSERT INTO departments (organization_id, name, is_active)
     VALUES ($1, $2, true)
     RETURNING id, name`,
    [orgId, name]
  );

  return result.rows[0];
}

async function ensureRole(orgId, name) {
  const existing = await client.query(
    `SELECT id, name FROM roles WHERE organization_id = $1 AND name = $2`,
    [orgId, name]
  );

  if (existing.rows[0]) return existing.rows[0];

  const result = await client.query(
    `INSERT INTO roles (organization_id, name)
     VALUES ($1, $2)
     RETURNING id, name`,
    [orgId, name]
  );

  return result.rows[0];
}

async function ensurePermission(name, description) {
  const result = await client.query(
    `INSERT INTO permissions (name, description)
     VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
     RETURNING id, name`,
    [name, description]
  );

  return result.rows[0];
}

async function ensureRolePermission(roleId, permissionId) {
  const existing = await client.query(
    `SELECT id FROM role_permissions WHERE role_id = $1 AND permission_id = $2`,
    [roleId, permissionId]
  );

  if (existing.rows.length > 0) return;

  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     VALUES ($1, $2)`,
    [roleId, permissionId]
  );
}

async function findRootPosition(orgId) {
  const result = await client.query(
    `SELECT id, title, path, parent_id FROM positions
     WHERE organization_id = $1 AND parent_id IS NULL AND is_active = true
     ORDER BY created_at ASC, id ASC
     LIMIT 1`,
    [orgId]
  );

  return result.rows[0] || null;
}

async function getExistingPosition(orgId, path) {
  const result = await client.query(
    `SELECT id, title, path, parent_id, organization_id FROM positions
     WHERE organization_id = $1 AND path = $2::ltree`,
    [orgId, path]
  );

  return result.rows[0] || null;
}

async function ensurePosition(orgId, def, deptMap, positionCache) {
  const parentPath = def.parent_path || null;

  if (def.path === BUILD_ROOT_PATH) {
    const root = await findRootPosition(orgId);
    if (root) {
      positionCache[def.path] = root;
      return root;
    }
  }

  const existing = await getExistingPosition(orgId, def.path);
  if (existing) {
    positionCache[def.path] = existing;
    return existing;
  }

  let parentId = null;
  if (parentPath) {
    let parent = positionCache[parentPath] || await getExistingPosition(orgId, parentPath);
    if (!parent) {
      parent = await client.query(
        `SELECT id, title, path, parent_id, organization_id FROM positions WHERE organization_id = $1 AND path = $2::ltree`,
        [orgId, parentPath]
      ).then(r => r.rows[0]);
    }
    if (!parent) {
      throw new Error(`Parent position not found for ${def.title}: ${parentPath}`);
    }
    parentId = parent.id;
    positionCache[parentPath] = parent;
  }

  const deptId = def.dept ? deptMap[def.dept]?.id || null : null;

  const row = await client.query(
    `INSERT INTO positions (organization_id, department_id, parent_id, title, path, is_active)
     VALUES ($1, $2, $3, $4, $5::ltree, true)
     RETURNING id, title, path, parent_id, organization_id`,
    [orgId, deptId, parentId, def.title, def.path]
  );

  const created = row.rows[0];
  positionCache[def.path] = created;
  return created;
}

async function ensurePerson(orgId, def) {
  const email = def.email.toLowerCase().trim();
  const existing = await client.query(
    `SELECT id, first_name, last_name, email, employee_id, workday_id
     FROM persons
     WHERE organization_id = $1 AND (email = $2 OR employee_id = $3)
     ORDER BY created_at ASC
     LIMIT 1`,
    [orgId, email, def.employee_id]
  );

  if (existing.rows[0]) {
    const row = existing.rows[0];
    const updated = await client.query(
      `UPDATE persons
       SET first_name = $2,
           last_name = $3,
           email = $4,
           employee_id = $5,
           password_hash = $6,
           workday_id = COALESCE(workday_id, 'WD-' || LPAD(nextval('workday_id_seq')::text, 6, '0')),
           is_active = true,
           activation_status = 'ACTIVE',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, first_name, last_name, email, employee_id, workday_id`,
      [row.id, def.first_name, def.last_name, email, def.employee_id, def.password_hash]
    );
    return updated.rows[0];
  }

  const result = await client.query(
    `INSERT INTO persons (
        organization_id, first_name, last_name, email, employee_id, password_hash,
        workday_id, is_active, activation_status
      )
     VALUES (
        $1, $2, $3, $4, $5, $6,
        'WD-' || LPAD(nextval('workday_id_seq')::text, 6, '0'), true, 'ACTIVE'
      )
     RETURNING id, first_name, last_name, email, employee_id, workday_id`,
    [orgId, def.first_name, def.last_name, email, def.employee_id, def.password_hash]
  );

  return result.rows[0];
}

async function getActivePrimaryPositionPaths(orgId) {
  const result = await client.query(
    `SELECT DISTINCT pos.path
     FROM position_assignments pa
     JOIN positions pos ON pos.id = pa.position_id
     WHERE pos.organization_id = $1
       AND pa.is_primary = true
       AND pa.end_date IS NULL`,
    [orgId]
  );

  return new Set(result.rows.map((row) => row.path));
}

async function setPrimaryAssignment(personId, positionId) {
  const existing = await client.query(
    `SELECT id FROM position_assignments
     WHERE person_id = $1 AND is_primary = true AND end_date IS NULL AND position_id = $2`,
    [personId, positionId]
  );

  if (existing.rows.length > 0) return;

  const active = await client.query(
    `SELECT id, position_id FROM position_assignments
     WHERE person_id = $1 AND is_primary = true AND end_date IS NULL`,
    [personId]
  );

  if (active.rows.length > 0) {
    await client.query(
      `UPDATE position_assignments
       SET is_primary = false, updated_at = CURRENT_TIMESTAMP
       WHERE person_id = $1 AND is_primary = true AND end_date IS NULL`,
      [personId]
    );
  }

  const assignmentCheck = await client.query(
    `SELECT id FROM position_assignments
     WHERE person_id = $1 AND position_id = $2 AND is_primary = true AND end_date IS NULL`,
    [personId, positionId]
  );

  if (assignmentCheck.rows.length > 0) return;

  await client.query(
    `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
     VALUES ($1, $2, true, current_date)`,
    [personId, positionId]
  );
}

async function ensurePersonRole(personId, roleId) {
  const existing = await client.query(
    `SELECT id FROM person_roles WHERE person_id = $1 AND role_id = $2`,
    [personId, roleId]
  );

  if (existing.rows.length > 0) return;

  await client.query(
    `INSERT INTO person_roles (person_id, role_id)
     VALUES ($1, $2)`,
    [personId, roleId]
  );
}

async function ensureLeaveTypeAndPolicy(orgId, name, days, isPaid) {
  let leaveType = await client.query(
    `SELECT id, name FROM leave_types WHERE organization_id = $1 AND name = $2`,
    [orgId, name]
  );

  if (leaveType.rows.length === 0) {
    leaveType = await client.query(
      `INSERT INTO leave_types (organization_id, name, is_paid, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, name`,
      [orgId, name, isPaid]
    );
  }

  const leaveTypeId = leaveType.rows[0].id;
  const existingPolicy = await client.query(
    `SELECT id FROM leave_policies WHERE leave_type_id = $1`,
    [leaveTypeId]
  );

  if (existingPolicy.rows.length === 0) {
    await client.query(
      `INSERT INTO leave_policies (leave_type_id, days_allowed, carry_forward_allowed)
       VALUES ($1, $2, false)`,
      [leaveTypeId, days]
    );
  }

  return leaveType.rows[0];
}

async function ensureAyeshaCompensation(personId) {
  const existing = await client.query(
    `SELECT id FROM salary_structures WHERE person_id = $1 AND is_active = true LIMIT 1`,
    [personId]
  );
  if (existing.rows.length === 0) {
    await client.query(
      `INSERT INTO salary_structures (person_id, base_salary, allowances, effective_from, is_active)
       VALUES ($1, 50000.00, 5000.00, current_date, true)`,
      [personId]
    );
  }

  const sampleComponents = [
    { type: 'BASIC', calc: 'FIXED', base: null, val: 25000, amt: 25000 },
    { type: 'HRA', calc: 'PERCENTAGE', base: 'BASIC', val: 25.00, amt: 12500 },
    { type: 'STANDARD_ALLOWANCE', calc: 'FIXED', base: null, val: 3000, amt: 3000 },
    { type: 'PERFORMANCE_BONUS', calc: 'FIXED', base: null, val: 5000, amt: 5000 },
    { type: 'LTA', calc: 'FIXED', base: null, val: 5000, amt: 5000 },
    { type: 'FIXED_ALLOWANCE', calc: 'FIXED', base: null, val: 2000, amt: 2000 },
  ];

  for (const comp of sampleComponents) {
    const current = await client.query(
      `SELECT id FROM salary_components WHERE person_id = $1 AND component_type = $2 LIMIT 1`,
      [personId, comp.type]
    );
    if (current.rows.length === 0) {
      await client.query(
        `INSERT INTO salary_components (person_id, component_type, calculation_type, percentage_base, configured_value, calculated_amount, is_active, effective_from)
         VALUES ($1, $2, $3, $4, $5, $6, true, current_date)`,
        [personId, comp.type, comp.calc, comp.base, comp.val, comp.amt]
      );
    }
  }

  const payrollCheck = await client.query(
    `SELECT id FROM payroll WHERE person_id = $1 AND year = 2026 AND month = 9 LIMIT 1`,
    [personId]
  );

  if (payrollCheck.rows.length === 0) {
    await client.query(
      `INSERT INTO payroll (
          person_id, year, month, total_earnings, total_deductions, net_salary, status,
          basic_salary, hra, standard_allowance, performance_bonus, leave_travel_allowance, fixed_allowance, stock_equity,
          tds, provident_fund, professional_tax, other_deductions, working_days, paid_days
        ) VALUES (
          $1, 2026, 9, 52500.00, 6200.00, 46300.00, 'Pending',
          25000.00, 12500.00, 3000.00, 5000.00, 5000.00, 2000.00, 0.00,
          3000.00, 3000.00, 200.00, 0.00, 22, 22
       )`,
      [personId]
    );
  }
}

async function seed() {
  await client.connect();
  console.log('🌱 Connected to database. Starting seed...');

  try {
    await client.query('BEGIN');

    await ensureWorkdaySupport();

    section('Organizations');
    const org = await ensureOrg();
    log(`✅ Org: ${org.name} (${org.slug}) — id: ${org.id}`);

    section('Departments');
    const deptNames = [
      'Engineering',
      'Human Resources',
      'Finance',
      'Product',
      'Quality Assurance',
      'Infrastructure & Cloud',
      'Information Security',
      'Operations',
      'Sales',
      'Marketing',
      'Customer Success',
      'Legal & Compliance',
      'Information Technology',
    ];
    const deptMap = {};
    for (const name of deptNames) {
      const dept = await ensureDepartment(org.id, name);
      deptMap[name] = dept;
      log(`✅ Dept: ${dept.name}`);
    }

    section('Positions (ltree hierarchy)');
    const positions = {};
    const positionDefs = [
      { title: 'CEO', path: 'acme_corp', parent_path: null, dept: null },
      { title: 'CTO', path: 'acme_corp.cto', parent_path: 'acme_corp', dept: 'Engineering' },
      { title: 'CFO', path: 'acme_corp.cfo', parent_path: 'acme_corp', dept: 'Finance' },
      { title: 'CHRO / HR Director', path: 'acme_corp.chro', parent_path: 'acme_corp', dept: 'Human Resources' },
      { title: 'COO', path: 'acme_corp.coo', parent_path: 'acme_corp', dept: 'Operations' },
      { title: 'CPO', path: 'acme_corp.cpo', parent_path: 'acme_corp', dept: 'Product' },
      { title: 'CISO / Head of Security', path: 'acme_corp.ciso', parent_path: 'acme_corp', dept: 'Information Security' },
      { title: 'Head of IT', path: 'acme_corp.head_of_it', parent_path: 'acme_corp', dept: 'Information Technology' },
      { title: 'Head of Sales', path: 'acme_corp.head_of_sales', parent_path: 'acme_corp', dept: 'Sales' },
      { title: 'Head of Marketing', path: 'acme_corp.head_of_marketing', parent_path: 'acme_corp', dept: 'Marketing' },
      { title: 'Head of Customer Success', path: 'acme_corp.head_of_customer_success', parent_path: 'acme_corp', dept: 'Customer Success' },
      { title: 'Legal & Compliance Lead', path: 'acme_corp.legal_and_compliance', parent_path: 'acme_corp', dept: 'Legal & Compliance' },
      { title: 'VP Engineering', path: 'acme_corp.cto.vp_engineering', parent_path: 'acme_corp.cto', dept: 'Engineering' },
      { title: 'Engineering Manager - Backend', path: 'acme_corp.cto.vp_engineering.backend_manager', parent_path: 'acme_corp.cto.vp_engineering', dept: 'Engineering' },
      { title: 'Engineering Manager - Frontend', path: 'acme_corp.cto.vp_engineering.frontend_manager', parent_path: 'acme_corp.cto.vp_engineering', dept: 'Engineering' },
      { title: 'Senior Backend Engineer', path: 'acme_corp.cto.vp_engineering.backend_manager.senior_backend_engineer', parent_path: 'acme_corp.cto.vp_engineering.backend_manager', dept: 'Engineering' },
      { title: 'Backend Engineer', path: 'acme_corp.cto.vp_engineering.backend_manager.backend_engineer', parent_path: 'acme_corp.cto.vp_engineering.backend_manager', dept: 'Engineering' },
      { title: 'Senior Frontend Engineer', path: 'acme_corp.cto.vp_engineering.frontend_manager.senior_frontend_engineer', parent_path: 'acme_corp.cto.vp_engineering.frontend_manager', dept: 'Engineering' },
      { title: 'Frontend Engineer', path: 'acme_corp.cto.vp_engineering.frontend_manager.frontend_engineer', parent_path: 'acme_corp.cto.vp_engineering.frontend_manager', dept: 'Engineering' },
      { title: 'QA Lead', path: 'acme_corp.cto.vp_engineering.qa_lead', parent_path: 'acme_corp.cto.vp_engineering', dept: 'Quality Assurance' },
      { title: 'QA Engineer', path: 'acme_corp.cto.vp_engineering.qa_engineer', parent_path: 'acme_corp.cto.vp_engineering.qa_lead', dept: 'Quality Assurance' },
      { title: 'Head of DevOps & Cloud', path: 'acme_corp.cto.devops', parent_path: 'acme_corp.cto', dept: 'Infrastructure & Cloud' },
      { title: 'DevOps Engineer', path: 'acme_corp.cto.devops.devops_engineer', parent_path: 'acme_corp.cto.devops', dept: 'Infrastructure & Cloud' },
      { title: 'Security Engineer', path: 'acme_corp.ciso.security_engineer', parent_path: 'acme_corp.ciso', dept: 'Information Security' },
      { title: 'Product Manager', path: 'acme_corp.cpo.product_manager', parent_path: 'acme_corp.cpo', dept: 'Product' },
      { title: 'Finance Manager', path: 'acme_corp.cfo.finance_manager', parent_path: 'acme_corp.cfo', dept: 'Finance' },
      { title: 'HR Manager', path: 'acme_corp.chro.hr_manager', parent_path: 'acme_corp.chro', dept: 'Human Resources' },
      { title: 'Operations Manager', path: 'acme_corp.coo.operations_manager', parent_path: 'acme_corp.coo', dept: 'Operations' },
      { title: 'Account Executive', path: 'acme_corp.head_of_sales.account_executive', parent_path: 'acme_corp.head_of_sales', dept: 'Sales' },
      { title: 'Marketing Manager', path: 'acme_corp.head_of_marketing.marketing_manager', parent_path: 'acme_corp.head_of_marketing', dept: 'Marketing' },
      { title: 'Customer Success Manager', path: 'acme_corp.head_of_customer_success.customer_success_manager', parent_path: 'acme_corp.head_of_customer_success', dept: 'Customer Success' },
      { title: 'IT Support Specialist', path: 'acme_corp.head_of_it.it_support_specialist', parent_path: 'acme_corp.head_of_it', dept: 'Information Technology' },
    ];

    for (const def of positionDefs) {
      const row = await ensurePosition(org.id, def, deptMap, positions);
      log(`✅ Position: ${row.title.padEnd(25)} path: ${row.path}`);
    }

    section('Persons');
    const roleNames = ['Org Admin', 'CEO', 'HR Manager', 'Employee'];
    const roleMap = {};
    for (const name of roleNames) {
      roleMap[name] = await ensureRole(org.id, name);
    }

    const peopleDefs = [
      { first_name: 'John', last_name: 'Admin', email: 'john.admin@acme-corp.com', employee_id: 'EMP-001', password_hash: await bcrypt.hash('Admin@1234', 12), position_path: 'acme_corp', role: 'Org Admin' },
      { first_name: 'Rohan', last_name: 'Sharma', email: 'rohan@acme-corp.com', employee_id: 'EMP-002', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering.backend_manager.senior_backend_engineer', role: 'Employee' },
      { first_name: 'Ayesha', last_name: 'Khan', email: 'ayesha@acme-corp.com', employee_id: 'EMP-003', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.chro.hr_manager', role: 'HR Manager' },
      { first_name: 'Vikram', last_name: 'Mehta', email: 'vikram.mehta@acme-corp.com', employee_id: 'EMP-004', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto', role: 'Employee' },
      { first_name: 'Neha', last_name: 'Iyer', email: 'neha.iyer@acme-corp.com', employee_id: 'EMP-005', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cfo', role: 'Employee' },
      { first_name: 'Arjun', last_name: 'Rao', email: 'arjun.rao@acme-corp.com', employee_id: 'EMP-006', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering', role: 'Employee' },
      { first_name: 'Kabir', last_name: 'Singh', email: 'kabir.singh@acme-corp.com', employee_id: 'EMP-007', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering.backend_manager', role: 'Employee' },
      { first_name: 'Meera', last_name: 'Joshi', email: 'meera.joshi@acme-corp.com', employee_id: 'EMP-008', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering.frontend_manager', role: 'Employee' },
      { first_name: 'Ishan', last_name: 'Kapoor', email: 'ishan.kapoor@acme-corp.com', employee_id: 'EMP-009', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering.backend_manager.senior_backend_engineer', role: 'Employee' },
      { first_name: 'Tara', last_name: 'Menon', email: 'tara.menon@acme-corp.com', employee_id: 'EMP-010', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering.backend_manager.backend_engineer', role: 'Employee' },
      { first_name: 'Aditya', last_name: 'Nair', email: 'aditya.nair@acme-corp.com', employee_id: 'EMP-011', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering.frontend_manager.senior_frontend_engineer', role: 'Employee' },
      { first_name: 'Pooja', last_name: 'Desai', email: 'pooja.desai@acme-corp.com', employee_id: 'EMP-012', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering.frontend_manager.frontend_engineer', role: 'Employee' },
      { first_name: 'Nikhil', last_name: 'Verma', email: 'nikhil.verma@acme-corp.com', employee_id: 'EMP-013', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering.qa_lead', role: 'Employee' },
      { first_name: 'Sameer', last_name: 'Kulkarni', email: 'sameer.kulkarni@acme-corp.com', employee_id: 'EMP-014', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cto.vp_engineering.qa_engineer', role: 'Employee' },
      { first_name: 'Ritu', last_name: 'Malhotra', email: 'ritu.malhotra@acme-corp.com', employee_id: 'EMP-015', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.ciso', role: 'Employee' },
      { first_name: 'Ananya', last_name: 'Bose', email: 'ananya.bose@acme-corp.com', employee_id: 'EMP-016', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.ciso.security_engineer', role: 'Employee' },
      { first_name: 'Farhan', last_name: 'Ali', email: 'farhan.ali@acme-corp.com', employee_id: 'EMP-017', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cpo.product_manager', role: 'Employee' },
      { first_name: 'Kavya', last_name: 'Shah', email: 'kavya.shah@acme-corp.com', employee_id: 'EMP-018', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.cpo.product_manager', role: 'Employee' },
      { first_name: 'Yash', last_name: 'Patil', email: 'yash.patil@acme-corp.com', employee_id: 'EMP-019', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.coo.operations_manager', role: 'Employee' },
      { first_name: 'Suresh', last_name: 'Iyer', email: 'suresh.iyer@acme-corp.com', employee_id: 'EMP-020', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.coo.operations_manager', role: 'Employee' },
      { first_name: 'Divya', last_name: 'Menon', email: 'divya.menon@acme-corp.com', employee_id: 'EMP-021', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.head_of_sales', role: 'Employee' },
      { first_name: 'Sneha', last_name: 'Kapoor', email: 'sneha.kapoor@acme-corp.com', employee_id: 'EMP-022', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.head_of_sales.account_executive', role: 'Employee' },
      { first_name: 'Manish', last_name: 'Gupta', email: 'manish.gupta@acme-corp.com', employee_id: 'EMP-023', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.head_of_marketing', role: 'Employee' },
      { first_name: 'Rahul', last_name: 'Bansal', email: 'rahul.bansal@acme-corp.com', employee_id: 'EMP-024', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.head_of_marketing.marketing_manager', role: 'Employee' },
      { first_name: 'Tanvi', last_name: 'Rao', email: 'tanvi.rao@acme-corp.com', employee_id: 'EMP-025', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.head_of_customer_success', role: 'Employee' },
      { first_name: 'Karan', last_name: 'Malhotra', email: 'karan.malhotra@acme-corp.com', employee_id: 'EMP-026', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.head_of_customer_success.customer_success_manager', role: 'Employee' },
      { first_name: 'Simran', last_name: 'Kaur', email: 'simran.kaur@acme-corp.com', employee_id: 'EMP-027', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.head_of_it', role: 'Employee' },
      { first_name: 'Nitin', last_name: 'Jain', email: 'nitin.jain@acme-corp.com', employee_id: 'EMP-028', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.head_of_it.it_support_specialist', role: 'Employee' },
      { first_name: 'Priya', last_name: 'Shetty', email: 'priya.shetty@acme-corp.com', employee_id: 'EMP-029', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.chro.hr_manager', role: 'Employee' },
      { first_name: 'Omar', last_name: 'Khan', email: 'omar.khan@acme-corp.com', employee_id: 'EMP-030', password_hash: DEFAULT_PASSWORD_HASH, position_path: 'acme_corp.legal_and_compliance', role: 'Employee' },
    ];

    const personMap = {};
    for (const def of peopleDefs) {
      const person = await ensurePerson(org.id, def);
      personMap[def.email] = person;
      log(`✅ Person: ${person.first_name} ${person.last_name} (${person.email}) — ID: ${person.employee_id}`);
    }

    section('Position Assignments');

    const explicitFixtureAssignments = [
      {
        email: 'john.admin@acme-corp.com',
        positionPath: 'acme_corp',
        requiredTitle: 'CEO',
      },
    ];

    const activePrimaryAssignments = await client.query(
      `SELECT pa.id, pa.person_id, pa.position_id, pos.path, p.email
       FROM position_assignments pa
       JOIN positions pos ON pos.id = pa.position_id
       JOIN persons p ON p.id = pa.person_id
       WHERE pa.is_primary = true AND pa.end_date IS NULL
         AND p.organization_id = $1`,
      [org.id]
    );

    const activePrimaryByPosition = new Map();
    for (const row of activePrimaryAssignments.rows) {
      activePrimaryByPosition.set(row.position_id, row);
    }

    for (const fixture of explicitFixtureAssignments) {
      const person = personMap[fixture.email];
      if (!person) {
        throw new Error(`Fixture user ${fixture.email} was not created in the seed.`);
      }

      const ceoPosition = positions[fixture.positionPath] || await getExistingPosition(org.id, fixture.positionPath);
      if (!ceoPosition) {
        throw new Error(`Expected fixture position not found for ${fixture.email}: ${fixture.positionPath}`);
      }

      if (ceoPosition.title !== fixture.requiredTitle) {
        throw new Error(
          `Fixture position title mismatch for ${fixture.email}: expected ${fixture.requiredTitle}, got ${ceoPosition.title}`
        );
      }

      const occupiedBy = activePrimaryByPosition.get(ceoPosition.id);
      if (occupiedBy && occupiedBy.person_id !== person.id) {
        throw new Error(
          `CEO position is already assigned to ${occupiedBy.email}; refusing to move John Admin.`
        );
      }

      await client.query(
        `UPDATE position_assignments
         SET is_primary = false, updated_at = CURRENT_TIMESTAMP
         WHERE person_id = $1 AND is_primary = true AND end_date IS NULL`,
        [person.id]
      );

      const existingAssignment = await client.query(
        `SELECT id FROM position_assignments
         WHERE person_id = $1 AND position_id = $2 AND end_date IS NULL
         LIMIT 1`,
        [person.id, ceoPosition.id]
      );

      if (existingAssignment.rows[0]) {
        await client.query(
          `UPDATE position_assignments
           SET is_primary = true, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [existingAssignment.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
           VALUES ($1, $2, true, CURRENT_DATE)`,
          [person.id, ceoPosition.id]
        );
      }

      log(`✅ Fixture assignment restored: ${person.first_name} ${person.last_name} → ${ceoPosition.path} (${ceoPosition.title})`);
    }

    for (const def of peopleDefs) {
      if (def.email === 'john.admin@acme-corp.com') continue;

      const person = personMap[def.email];
      const position = positions[def.position_path] || await getExistingPosition(org.id, def.position_path);
      if (!position) {
        log(`⚠️ Skipping ${person.first_name} ${person.last_name}: requested position not found (${def.position_path}).`);
        continue;
      }

      const currentPrimary = await client.query(
        `SELECT pa.id, pos.path
         FROM position_assignments pa
         JOIN positions pos ON pos.id = pa.position_id
         WHERE pa.person_id = $1 AND pa.is_primary = true AND pa.end_date IS NULL
         LIMIT 1`,
        [person.id]
      );

      if (currentPrimary.rows[0]) {
        const existingPath = currentPrimary.rows[0].path;
        if (existingPath !== position.path) {
          log(
            `⚠️ Preserving existing assignment for ${person.first_name} ${person.last_name}: ${existingPath}; not reassigning to ${position.path}.`
          );
          continue;
        }
        log(`✅ Existing assignment preserved for ${person.first_name} ${person.last_name} → ${position.path}`);
        continue;
      }

      const occupied = await client.query(
        `SELECT p.email
         FROM position_assignments pa
         JOIN persons p ON p.id = pa.person_id
         WHERE pa.position_id = $1 AND pa.is_primary = true AND pa.end_date IS NULL
         LIMIT 1`,
        [position.id]
      );

      if (occupied.rows[0]) {
        log(
          `⚠️ Skipping ${person.first_name} ${person.last_name}: requested position ${position.path} is occupied by ${occupied.rows[0].email}.`
        );
        continue;
      }

      await client.query(
        `INSERT INTO position_assignments (person_id, position_id, is_primary, start_date)
         VALUES ($1, $2, true, CURRENT_DATE)`,
        [person.id, position.id]
      );
      log(`✅ Assigned ${person.first_name} ${person.last_name} → ${position.path}`);
    }

    section('Role assignment');
    for (const def of peopleDefs) {
      const person = personMap[def.email];
      const role = roleMap[def.role];
      if (role) {
        await ensurePersonRole(person.id, role.id);
      }
      log(`✅ Role ${def.role} → ${person.first_name} ${person.last_name}`);
    }

    section('Permissions and mappings');
    const permDefs = [
      ['manage_org', 'Can manage organization settings'],
      ['manage_roles', 'Can create and assign roles'],
      ['manage_employees', 'Can create, update, deactivate employees'],
      ['view_attendance', 'Can view attendance records'],
      ['manage_attendance', 'Can edit and correct attendance records'],
      ['approve_leaves', 'Can approve or reject leave requests'],
      ['view_payroll', 'Can view payroll data'],
      ['view_hierarchy', 'Can view organization hierarchy and org chart'],
      ['manage_hierarchy', 'Can move employees, positions and reorganize hierarchy'],
      ['finance:read', 'Can view organization financial summary and reports'],
      ['finance:write', 'Can modify financial settings and records'],
      ['billing:read', 'Can view billing and subscription details'],
      ['billing:write', 'Can update billing information'],
      ['subscription:manage', 'Can change organization subscription plan'],
    ];

    const perms = {};
    for (const [name, description] of permDefs) {
      perms[name] = await ensurePermission(name, description);
      log(`✅ Permission: ${name}`);
    }

    const rolePermMap = {
      'Org Admin': ['manage_org', 'manage_roles', 'manage_employees', 'view_attendance', 'manage_attendance', 'approve_leaves', 'view_payroll', 'view_hierarchy', 'manage_hierarchy', 'finance:read', 'finance:write', 'billing:read', 'billing:write', 'subscription:manage'],
      'CEO': ['manage_org', 'view_attendance', 'view_payroll', 'view_hierarchy', 'finance:read', 'billing:read', 'subscription:manage'],
      'HR Manager': ['manage_employees', 'view_attendance', 'approve_leaves', 'view_hierarchy'],
      'Employee': ['view_attendance', 'view_hierarchy'],
    };

    for (const [roleName, permissionNames] of Object.entries(rolePermMap)) {
      const role = roleMap[roleName];
      if (!role) continue;
      for (const permName of permissionNames) {
        await ensureRolePermission(role.id, perms[permName].id);
      }
      log(`✅ ${roleName.padEnd(15)} → ${permissionNames.join(', ')}`);
    }

    section('Subscriptions');
    const subPlans = [
      { name: 'Starter', slug: 'starter', max_employees: 50, price_cents: 0, metadata: { features: ['basic_attendance', 'basic_leaves'] } },
      { name: 'Growth', slug: 'growth', max_employees: 100, price_cents: 0, metadata: { features: ['basic_attendance', 'basic_leaves', 'financial_dashboard', 'billing_portal', 'subscription_management'] } },
    ];
    for (const plan of subPlans) {
      await client.query(
        `INSERT INTO subscription_plans (name, slug, max_employees, price_cents, currency, metadata)
         VALUES ($1, $2, $3, $4, 'USD', $5::jsonb)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, max_employees = EXCLUDED.max_employees, price_cents = EXCLUDED.price_cents, metadata = EXCLUDED.metadata`,
        [plan.name, plan.slug, plan.max_employees, plan.price_cents, JSON.stringify(plan.metadata)]
      );
    }

    const growth = await client.query(`SELECT id FROM subscription_plans WHERE slug = 'growth' LIMIT 1`);
    if (growth.rows[0]) {
      const existingSubscription = await client.query(
        `SELECT id FROM organization_subscriptions WHERE organization_id = $1 LIMIT 1`,
        [org.id]
      );
      if (existingSubscription.rows.length === 0) {
        await client.query(
          `INSERT INTO organization_subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
           VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '1 year')`,
          [org.id, growth.rows[0].id]
        );
      }
    }

    section('Leave Types & Policies');
    await ensureLeaveTypeAndPolicy(org.id, 'Annual Leave', 10.0, true);
    await ensureLeaveTypeAndPolicy(org.id, 'Sick Leave', 7.0, true);
    await ensureLeaveTypeAndPolicy(org.id, 'Casual Leave', 5.0, true);

    section('Compensation & Payroll');
    const ayesha = personMap['ayesha@acme-corp.com'];
    if (ayesha) {
      await ensureAyeshaCompensation(ayesha.id);
      log('✅ Compensation & Payroll verified for Ayesha Khan');
    }

    section('Audit Log');
    const admin = personMap['john.admin@acme-corp.com'];
    await client.query(
      `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
       VALUES ($1, 'organization', $2, 'SEED', NULL, $3::jsonb, $4, 'Initial seed script — development environment setup')`,
      [org.id, org.id, JSON.stringify({ name: org.name, slug: org.slug, seeded_at: new Date().toISOString() }), admin?.id || null]
    );
    log('✅ Audit log entry inserted (action: SEED)');

    await client.query('COMMIT');

    console.log(`
╔══════════════════════════════════════════════════════╗
║  ✅  Seed complete! Summary:                         ║
║                                                      ║
║  Org:      Acme Corp  (slug: acme-corp)              ║
║  Depts:    13 departments                             ║
║  Positions: 32+ hierarchy nodes                      ║
║  Employees: 30 total active employees                 ║
║  Root:      CEO preserved at acme_corp               ║
║  John:      Org Admin unchanged                      ║
║  Ayesha:    HR Manager + payroll preserved           ║
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
