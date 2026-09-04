/**
 * Migration 020: Create Resignation Management Module
 *
 * Reintroduces the resignation module on the current dev migration chain.
 *
 * This migration is intentionally safe for databases where the resignation
 * schema already exists (for example, a local database that previously had
 * the old feature/workday-id migration applied).
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  // 1. Add employment_status only if it does not already exist.
  pgm.sql(`
    ALTER TABLE persons
    ADD COLUMN IF NOT EXISTS employment_status varchar(50)
    NOT NULL DEFAULT 'ACTIVE';
  `);

  // 2. Create employment_status index if it does not already exist.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS persons_employment_status_index
    ON persons (employment_status);
  `);

  // 3. Create resignations table if it does not already exist.
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS resignations (
      id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
      organization_id uuid NOT NULL
        REFERENCES organizations(id) ON DELETE CASCADE,
      person_id uuid NOT NULL
        REFERENCES persons(id) ON DELETE CASCADE,
      submission_date date NOT NULL DEFAULT CURRENT_DATE,
      proposed_last_working_day date NOT NULL,
      approved_last_working_day date,
      reason text NOT NULL,
      comments text,
      status varchar(50) NOT NULL DEFAULT 'PENDING_MANAGER_REVIEW',
      manager_id uuid
        REFERENCES persons(id) ON DELETE SET NULL,
      manager_reviewed_at timestamptz,
      manager_comment text,
      hr_id uuid
        REFERENCES persons(id) ON DELETE SET NULL,
      hr_reviewed_at timestamptz,
      hr_comment text,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Required indexes.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS resignations_organization_id_index
    ON resignations (organization_id);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS resignations_person_id_index
    ON resignations (person_id);
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS resignations_status_index
    ON resignations (status);
  `);

  // 5. Prevent multiple active resignations for the same employee.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS resignations_single_active_per_person
    ON resignations (person_id)
    WHERE status IN (
      'PENDING_MANAGER_REVIEW',
      'MANAGER_APPROVED',
      'HR_REVIEW',
      'APPROVED',
      'NOTICE_PERIOD'
    );
  `);
};

/**
 * Roll back the resignation module.
 *
 * WARNING:
 * This removes the resignation table and employment_status column.
 * It is intentionally explicit rather than using IF EXISTS so that an
 * accidental rollback is visible during development.
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS resignations_single_active_per_person;
  `);

  pgm.sql(`
    DROP TABLE IF EXISTS resignations;
  `);

  pgm.sql(`
    DROP INDEX IF EXISTS persons_employment_status_index;
  `);

  pgm.sql(`
    ALTER TABLE persons
    DROP COLUMN IF EXISTS employment_status;
  `);
};