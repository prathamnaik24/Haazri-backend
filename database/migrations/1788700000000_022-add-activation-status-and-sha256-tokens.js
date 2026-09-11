/**
 * Migration 022: Add activation_status to persons + SHA-256 token index
 *
 * Why this migration exists
 * ─────────────────────────
 * The previous invite flow stored token hashes using bcrypt, which requires an
 * O(N) full-table scan to validate a token. We switch to SHA-256 so validation
 * is a single indexed lookup (O(1)).
 *
 * Additionally, employees now have an explicit `activation_status` column so
 * that the login check can distinguish:
 *   • Already-passworded / seeded accounts → ACTIVE (can log in normally)
 *   • Freshly created, password not yet set → PENDING_ACTIVATION (blocked login)
 *
 * Safe backfill logic
 * ───────────────────
 * We CANNOT reliably tell from `password_hash` alone whether a password was
 * intentionally set, because createEmployee() always inserts a cryptographically
 * random placeholder hash. Instead we use org_invite_tokens:
 *
 *   • No unconsumed (used_at IS NULL, not expired) token → assume the employee
 *     either already accepted their invite OR was seeded with a real password.
 *     → ACTIVE
 *   • Has an unconsumed, non-expired token → genuinely pending.
 *     → PENDING_ACTIVATION
 *
 * In a fresh dev database seeded from seed.js, ALL existing persons will land on
 * ACTIVE because the seed data never leaves unconsumed invite tokens.
 *
 * Token invalidation
 * ──────────────────
 * All remaining bcrypt-hashed tokens are INCOMPATIBLE with SHA-256 lookup
 * (a bcrypt hash cannot be re-verified by a digest comparison). We mark every
 * remaining unused token as consumed NOW so they are never returned as valid.
 * Developers MUST generate fresh invitation links after pulling this migration.
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = async (pgm) => {
  // ── 1. Add activation_status as nullable first ─────────────────────
  pgm.sql(`
    ALTER TABLE persons
      ADD COLUMN IF NOT EXISTS activation_status VARCHAR(30);
  `);

  // ── 2. Back-fill: mark employees with no pending unconsumed token as ACTIVE ──
  //    These are seeded accounts and employees who already accepted an invite.
  pgm.sql(`
    UPDATE persons p
    SET activation_status = 'ACTIVE'
    WHERE NOT EXISTS (
      SELECT 1
      FROM org_invite_tokens t
      WHERE t.email = p.email
        AND t.organization_id = p.organization_id
        AND t.used_at IS NULL
        AND t.expires_at > NOW()
    );
  `);

  // ── 3. Mark employees that DO have a pending unconsumed token as PENDING ──
  pgm.sql(`
    UPDATE persons p
    SET activation_status = 'PENDING_ACTIVATION'
    WHERE activation_status IS NULL;
  `);

  // ── 4. Set column default for future inserts (createEmployee will use this) ──
  pgm.sql(`
    ALTER TABLE persons
      ALTER COLUMN activation_status SET DEFAULT 'PENDING_ACTIVATION';
  `);

  // ── 5. Enforce NOT NULL ──────────────────────────────────────────────
  pgm.sql(`
    ALTER TABLE persons
      ALTER COLUMN activation_status SET NOT NULL;
  `);

  // ── 6. Add CHECK constraint for allowed values ───────────────────────
  pgm.sql(`
    ALTER TABLE persons
      ADD CONSTRAINT persons_activation_status_check
      CHECK (activation_status IN ('PENDING_ACTIVATION', 'ACTIVE'));
  `);

  // ── 7. Add fast index for SHA-256 token lookup ───────────────────────
  //    This supports a single WHERE token_hash = $1 AND used_at IS NULL lookup.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS org_invite_tokens_sha_active_idx
      ON org_invite_tokens (token_hash)
      WHERE used_at IS NULL;
  `);

  // ── 8. Invalidate all remaining bcrypt-hashed tokens ────────────────
  //    *** DEV NOTE ***
  //    bcrypt hashes are NOT compatible with SHA-256 lookups. Any token stored
  //    before this migration will never validate. We explicitly mark them all
  //    consumed so the system never tries to compare them.
  //    → Developers MUST resend invitations for any PENDING_ACTIVATION employees
  //      after running this migration.
  pgm.sql(`
    UPDATE org_invite_tokens
    SET used_at = NOW()
    WHERE used_at IS NULL;
  `);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  console.warn(
    '[Migration 022 rollback] Removing activation_status from persons and SHA-256 token index. ' +
    'Previously invalidated bcrypt tokens will NOT be restored.'
  );

  pgm.sql(`
    DROP INDEX IF EXISTS org_invite_tokens_sha_active_idx;
  `);

  pgm.sql(`
    ALTER TABLE persons
      DROP CONSTRAINT IF EXISTS persons_activation_status_check;
  `);

  pgm.sql(`
    ALTER TABLE persons
      DROP COLUMN IF EXISTS activation_status;
  `);
};
