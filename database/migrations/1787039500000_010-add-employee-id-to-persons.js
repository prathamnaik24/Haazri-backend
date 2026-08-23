/**
 * Migration 010: Add employee_id to persons table
 *
 * Purpose:
 *   Adds a short, human-readable unique identifier for each person within
 *   their organization (e.g. EMP-001, STU-2024-045, HR-012).
 *
 *   - Assigned exclusively by the org admin when creating an employee.
 *   - Used as a second credential during employee login (alongside org_slug
 *     and password) to prevent spoofing and credential stuffing attacks.
 *   - Unique per organization (two orgs can both have EMP-001).
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  // Add employee_id column — nullable initially so existing rows are not broken
  pgm.addColumn('persons', {
    employee_id: {
      type: 'varchar(50)',
      notNull: false,
    },
  });

  // Composite unique constraint: employee_id must be unique per organization
  pgm.addConstraint('persons', 'persons_organization_employee_id_unique', {
    unique: ['organization_id', 'employee_id'],
  });
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropConstraint('persons', 'persons_organization_employee_id_unique');
  pgm.dropColumn('persons', 'employee_id');
};
