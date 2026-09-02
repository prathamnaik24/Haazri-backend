/**
 * Migration 017 -- Enforce single root position per organization
 *
 * Problem: The `positions` table has no constraint preventing multiple rows with
 * `parent_id IS NULL` for the same organization. Several orgs (including acme-corp)
 * ended up with two root ("CEO") positions.
 *
 * Fix:
 *   1. For every org with > 1 active root, keep the OLDEST root (lowest created_at).
 *   2. Re-parent the duplicate roots: set their parent_id = kept_root_id and update
 *      their ltree path so they become direct children of the kept root.
 *      Their subtrees are also re-pathed atomically using ltree operators.
 *   3. Write an audit_logs entry (ROOT_POSITION_DEMOTED) for each demoted root.
 *   4. Add a unique partial index so this can never happen again.
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = async (pgm) => {
  // -- Step 1: Fix existing duplicate roots ------------------------------------
  pgm.sql(`
    DO $$
    DECLARE
      org_rec RECORD;
      kept_root RECORD;
      dup_root RECORD;
      new_dup_path TEXT;
    BEGIN
      FOR org_rec IN
        SELECT organization_id, COUNT(*) AS root_count
        FROM positions
        WHERE parent_id IS NULL AND is_active = true
        GROUP BY organization_id
        HAVING COUNT(*) > 1
      LOOP
        -- The root we KEEP: oldest created_at, break ties by id (deterministic)
        SELECT p.id, p.path::text AS path, p.created_at
          INTO kept_root
          FROM positions p
          WHERE p.organization_id = org_rec.organization_id
            AND p.parent_id IS NULL
            AND p.is_active = true
          ORDER BY p.created_at ASC, p.id ASC
          LIMIT 1;

        FOR dup_root IN
          SELECT p.id, p.path::text AS path, p.title
            FROM positions p
            WHERE p.organization_id = org_rec.organization_id
              AND p.parent_id IS NULL
              AND p.is_active = true
              AND p.id <> kept_root.id
        LOOP
          new_dup_path := kept_root.path || '.' ||
                          replace(dup_root.path, '.', '_') || '_demoted';

          WHILE EXISTS (
            SELECT 1 FROM positions
            WHERE organization_id = org_rec.organization_id
              AND path::text = new_dup_path
              AND id <> dup_root.id
          ) LOOP
            new_dup_path := new_dup_path || '_1';
          END LOOP;

          -- Re-path the duplicate root AND all its descendants atomically
          UPDATE positions
          SET
            parent_id = CASE WHEN id = dup_root.id THEN kept_root.id ELSE parent_id END,
            path = CASE
              WHEN path::text = dup_root.path
                THEN new_dup_path::ltree
              ELSE (new_dup_path::ltree || subpath(path, nlevel(dup_root.path::ltree)))
            END,
            updated_at = CURRENT_TIMESTAMP
          WHERE organization_id = org_rec.organization_id
            AND path <@ dup_root.path::ltree;

          BEGIN
            INSERT INTO audit_logs
              (organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason)
            VALUES
              (
                org_rec.organization_id,
                'position',
                dup_root.id,
                'ROOT_POSITION_DEMOTED',
                jsonb_build_object(
                  'parent_id', NULL,
                  'path', dup_root.path,
                  'title', dup_root.title
                ),
                jsonb_build_object(
                  'parent_id', kept_root.id,
                  'path', new_dup_path,
                  'title', dup_root.title,
                  'kept_root_id', kept_root.id,
                  'kept_root_path', kept_root.path,
                  'reason', 'Migration 017: Enforced single root per organization'
                ),
                NULL,
                'Migration 017: Demoted duplicate root position'
              );
          EXCEPTION
            WHEN undefined_table THEN NULL;
          END;

          RAISE NOTICE 'Org %: demoted root % (%) under kept root % (%)',
            org_rec.organization_id, dup_root.id, dup_root.path,
            kept_root.id, kept_root.path;

        END LOOP;
      END LOOP;
    END;
    $$;
  `);

  // -- Step 2: Add unique partial index ----------------------------------------
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_one_root_per_org
      ON positions (organization_id)
      WHERE parent_id IS NULL AND is_active = true;
  `);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS idx_one_root_per_org;`);
  console.warn('Migration 017 DOWN: index removed. Demoted root positions were NOT restored.');
};
