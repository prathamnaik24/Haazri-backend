/**
 * Migration 017: Create Resignation Management Module
 *
 * Purpose:
 *   - Adds `employment_status` column to `persons` (default: 'ACTIVE').
 *   - Creates `resignations` table to track resignation lifecycles.
 *   - Adds partial unique index ensuring an employee can have at most ONE active resignation.
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  // 1. Add employment_status column to persons table
  pgm.addColumn('persons', {
    employment_status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'ACTIVE',
    },
  });

  // Index on employment_status for fast filtering
  pgm.createIndex('persons', 'employment_status');

  // 2. Create RESIGNATIONS table
  pgm.createTable('resignations', {
    id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: '"organizations"',
      onDelete: 'CASCADE',
    },
    person_id: {
      type: 'uuid',
      notNull: true,
      references: '"persons"',
      onDelete: 'CASCADE',
    },
    submission_date: {
      type: 'date',
      notNull: true,
      default: pgm.func('current_date'),
    },
    proposed_last_working_day: {
      type: 'date',
      notNull: true,
    },
    approved_last_working_day: {
      type: 'date',
    },
    reason: {
      type: 'text',
      notNull: true,
    },
    comments: {
      type: 'text',
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      default: 'PENDING_MANAGER_REVIEW',
    },
    manager_id: {
      type: 'uuid',
      references: '"persons"',
      onDelete: 'SET NULL',
    },
    manager_reviewed_at: {
      type: 'timestamptz',
    },
    manager_comment: {
      type: 'text',
    },
    hr_id: {
      type: 'uuid',
      references: '"persons"',
      onDelete: 'SET NULL',
    },
    hr_reviewed_at: {
      type: 'timestamptz',
    },
    hr_comment: {
      type: 'text',
    },
    completed_at: {
      type: 'timestamptz',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Indexes for querying resignations by org, person, status
  pgm.createIndex('resignations', 'organization_id');
  pgm.createIndex('resignations', 'person_id');
  pgm.createIndex('resignations', 'status');

  // Partial unique index enforcing AT MOST ONE active resignation per person
  // Active states: PENDING_MANAGER_REVIEW, MANAGER_APPROVED, HR_REVIEW, APPROVED, NOTICE_PERIOD
  pgm.sql(`
    CREATE UNIQUE INDEX resignations_single_active_per_person
    ON resignations (person_id)
    WHERE status IN ('PENDING_MANAGER_REVIEW', 'MANAGER_APPROVED', 'HR_REVIEW', 'APPROVED', 'NOTICE_PERIOD');
  `);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS resignations_single_active_per_person;');
  pgm.dropTable('resignations');
  pgm.dropColumn('persons', 'employment_status');
};
