export const up = (pgm) => {
  pgm.sql(`
    -- 1. Terminate older duplicate active primary assignments for any person
    WITH RankedAssignments AS (
      SELECT 
        id,
        ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY created_at DESC, id DESC) as rn
      FROM position_assignments
      WHERE is_primary = true AND end_date IS NULL
    )
    UPDATE position_assignments
    SET is_primary = false, end_date = CURRENT_DATE - 1, updated_at = CURRENT_TIMESTAMP
    WHERE id IN (
      SELECT id FROM RankedAssignments WHERE rn > 1
    );

    -- 2. Terminate older duplicate active primary assignments on any single position
    WITH RankedPositionAssignments AS (
      SELECT 
        id,
        ROW_NUMBER() OVER (PARTITION BY position_id ORDER BY created_at DESC, id DESC) as rn
      FROM position_assignments
      WHERE is_primary = true AND end_date IS NULL
    )
    UPDATE position_assignments
    SET is_primary = false, end_date = CURRENT_DATE - 1, updated_at = CURRENT_TIMESTAMP
    WHERE id IN (
      SELECT id FROM RankedPositionAssignments WHERE rn > 1
    );

    -- 3. Create unique partial index to guarantee 1 active primary position per person
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_primary_assignment_per_person
      ON position_assignments (person_id)
      WHERE is_primary = true AND end_date IS NULL;

    -- 4. Create unique partial index to guarantee at most 1 primary person per position
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_primary_person_per_position
      ON position_assignments (position_id)
      WHERE is_primary = true AND end_date IS NULL;
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_one_primary_person_per_position;
    DROP INDEX IF EXISTS idx_one_primary_assignment_per_person;
  `);
};
