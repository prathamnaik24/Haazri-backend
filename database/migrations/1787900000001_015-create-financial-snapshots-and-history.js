/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  // 1. financial_snapshots table
  pgm.createTable('financial_snapshots', {
    id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: '"organizations"', onDelete: 'CASCADE' },
    snapshot_date: { type: 'date', notNull: true },
    total_expenditure_cents: { type: 'integer', notNull: true },
    department_breakdown: { type: 'jsonb', notNull: true, default: '{}' },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.addConstraint('financial_snapshots', 'unique_org_snapshot_date', {
    unique: ['organization_id', 'snapshot_date'],
  });

  pgm.createIndex('financial_snapshots', ['organization_id', 'snapshot_date'], {
    name: 'idx_financial_snapshots_org_date',
  });

  // 2. organization_subscription_changes table
  pgm.createTable('organization_subscription_changes', {
    id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: '"organizations"', onDelete: 'CASCADE' },
    changed_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    changed_by_user_id: { type: 'uuid', notNull: true, references: '"persons"' },
    old_plan_id: { type: 'uuid', references: '"subscription_plans"' },
    new_plan_id: { type: 'uuid', notNull: true, references: '"subscription_plans"' },
    reason: { type: 'text' },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
  });

  pgm.createIndex('organization_subscription_changes', ['organization_id', 'changed_at'], {
    name: 'idx_sub_changes_org_date',
  });

  // 3. Provider-ready columns
  pgm.addColumn('organizations', {
    provider_customer_id: { type: 'text' },
  });

  pgm.addColumn('organization_subscriptions', {
    provider_plan_id: { type: 'text' },
  });
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropTable('organization_subscription_changes');
  pgm.dropTable('financial_snapshots');
};
