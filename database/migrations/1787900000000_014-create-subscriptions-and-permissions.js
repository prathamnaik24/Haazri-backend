/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  // 1. subscription_plans
  pgm.createTable('subscription_plans', {
    id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
    name: { type: 'text', notNull: true },
    slug: { type: 'text', notNull: true, unique: true },
    max_employees: { type: 'integer', notNull: true },
    price_cents: { type: 'integer', notNull: true },
    currency: { type: 'text', notNull: true, default: 'USD' },
    is_active: { type: 'boolean', notNull: true, default: true },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  // 2. organization_subscriptions
  pgm.createTable('organization_subscriptions', {
    id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: '"organizations"', onDelete: 'CASCADE', unique: true },
    plan_id: { type: 'uuid', notNull: true, references: '"subscription_plans"', onDelete: 'RESTRICT' },
    status: { type: 'text', notNull: true, default: 'active' },
    current_period_start: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    current_period_end: { type: 'timestamptz', notNull: true, default: pgm.func("current_timestamp + INTERVAL '1 year'") },
    cancel_at_period_end: { type: 'boolean', notNull: true, default: false },
    provider_subscription_id: { type: 'text' },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  // 3. Seed starter and growth subscription plans
  pgm.sql(`
    INSERT INTO subscription_plans (name, slug, max_employees, price_cents, metadata)
    VALUES
      (
        'Starter',
        'starter',
        50,
        0,
        '{"features": ["basic_attendance", "basic_leaves"]}'::jsonb
      ),
      (
        'Growth',
        'growth',
        100,
        0,
        '{"features": ["basic_attendance", "basic_leaves", "financial_dashboard", "billing_portal", "subscription_management"]}'::jsonb
      )
    ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name,
        max_employees = EXCLUDED.max_employees,
        price_cents = EXCLUDED.price_cents,
        metadata = EXCLUDED.metadata;
  `);

  // 4. Seed finance and billing permissions
  pgm.sql(`
    INSERT INTO permissions (name, description)
    VALUES
      ('finance:read', 'Can view organization financial summary and reports'),
      ('finance:write', 'Can modify financial settings and records'),
      ('billing:read', 'Can view billing and subscription details'),
      ('billing:write', 'Can update billing information'),
      ('subscription:manage', 'Can change organization subscription plan')
    ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;
  `);

  // 5. Assign finance & billing permissions to 'Org Admin' and 'CEO' roles
  pgm.sql(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    CROSS JOIN permissions p
    WHERE r.name IN ('Org Admin', 'CEO', 'admin', 'ceo')
      AND p.name IN ('finance:read', 'finance:write', 'billing:read', 'billing:write', 'subscription:manage')
    ON CONFLICT DO NOTHING;
  `);

  // 6. Assign active Growth subscription plan to any existing organizations that lack one
  pgm.sql(`
    INSERT INTO organization_subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
    SELECT o.id, sp.id, 'active', NOW(), NOW() + INTERVAL '1 year'
    FROM organizations o
    CROSS JOIN subscription_plans sp
    WHERE sp.slug = 'growth'
      AND NOT EXISTS (
        SELECT 1 FROM organization_subscriptions os WHERE os.organization_id = o.id
      )
    ON CONFLICT (organization_id) DO NOTHING;
  `);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropTable('organization_subscriptions');
  pgm.dropTable('subscription_plans');
};
