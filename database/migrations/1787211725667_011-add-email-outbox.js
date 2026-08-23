/**
 * Migration 011: Add Email Outbox and Status Fields
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  // 1. Add email status fields to org_invite_tokens
  pgm.addColumn('org_invite_tokens', {
    invite_email_status: { type: 'varchar(50)', default: 'pending' }, // pending, sent, failed, bounced
    invite_sent_at: { type: 'timestamptz' },
  });

  // 2. Create email_outbox table
  pgm.createTable('email_outbox', {
    id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: '"organizations"', onDelete: 'CASCADE' },
    to_email: { type: 'varchar(255)', notNull: true },
    template_key: { type: 'varchar(100)', notNull: true },
    payload_json: { type: 'jsonb', notNull: true },
    status: { type: 'varchar(50)', notNull: true, default: 'pending' }, // pending, processing, sent, failed
    attempt_count: { type: 'int', notNull: true, default: 0 },
    idempotency_key: { type: 'varchar(255)', notNull: true },
    last_error: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    sent_at: { type: 'timestamptz' },
  });

  // 3. Add composite unique constraint for idempotency key per org
  pgm.addConstraint('email_outbox', 'email_outbox_org_idempotency_unique', {
    unique: ['organization_id', 'idempotency_key'],
  });

  // 4. Create an index on status for faster worker polling
  pgm.createIndex('email_outbox', ['status']);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropIndex('email_outbox', ['status']);
  pgm.dropConstraint('email_outbox', 'email_outbox_org_idempotency_unique');
  pgm.dropTable('email_outbox');
  pgm.dropColumn('org_invite_tokens', ['invite_email_status', 'invite_sent_at']);
};
