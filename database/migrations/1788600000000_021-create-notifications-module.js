/**
 * Migration 021 — Create Notifications Module
 * Durable, multi-tenant, in-app notification records.
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.createTable('notifications', {
    id: {
      type: 'uuid',
      default: pgm.func('gen_random_uuid()'),
      primaryKey: true,
    },
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
    type: {
      type: 'varchar(50)',
      notNull: true,
      comment:
        'LEAVE_SUBMITTED | LEAVE_APPROVED | LEAVE_REJECTED | LEAVE_CANCELLED | SALARY_CREDITED | BONUS_CREDITED | PAYSLIP_AVAILABLE | INCREMENT_PROPOSED | INCREMENT_APPROVED | INCREMENT_REJECTED | RESIGNATION_UPDATE | GENERAL',
    },
    title: {
      type: 'varchar(255)',
      notNull: true,
    },
    message: {
      type: 'text',
      notNull: true,
    },
    entity_type: {
      type: 'varchar(50)',
      comment: 'leave_request | financial_record | payroll | payslip | salary_increment | resignation',
    },
    entity_id: {
      type: 'uuid',
    },
    metadata: {
      type: 'jsonb',
      default: pgm.func("'{}'::jsonb"),
    },
    is_read: {
      type: 'boolean',
      notNull: true,
      default: false,
    },
    read_at: {
      type: 'timestamptz',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  // Fast indexes for employee feed and badge counter
  pgm.addIndex('notifications', ['person_id', 'is_read', { name: 'created_at', sort: 'DESC' }]);
  pgm.addIndex('notifications', ['organization_id', 'person_id']);
  pgm.addIndex('notifications', ['entity_type', 'entity_id']);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropTable('notifications');
};
