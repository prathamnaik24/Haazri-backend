/**
 * Migration 012 — Office Settings, Attendance Punctuality, Finance Records, Leave Enhancements
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {

  // ─── 1. OFFICE SETTINGS ──────────────────────────────────────────────────────
  // Stores configurable org-wide or scoped settings such as the daily reporting time.
  pgm.createTable('office_settings', {
    id:              { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: '"organizations"', onDelete: 'CASCADE' },
    setting_key:     { type: 'varchar(100)', notNull: true },
    // e.g. 'default_reporting_time' — value is '09:30' (HH:MM 24h)
    setting_value:   { type: 'text', notNull: true },
    timezone:        { type: 'varchar(60)', default: "'Asia/Kolkata'" },
    scope_type:      { type: 'varchar(20)', default: "'org'" },
    // 'org' | 'department' | 'position'
    scope_id:        { type: 'uuid' },
    // null when scope_type = 'org'
    updated_by:      { type: 'uuid', references: '"persons"', onDelete: 'SET NULL' },
    updated_at:      { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.addIndex('office_settings', ['organization_id']);
  pgm.addIndex('office_settings', ['organization_id', 'setting_key', 'scope_type']);

  // ─── 2. ATTENDANCE — Add Punctuality Columns ─────────────────────────────────
  // Extends the existing 'attendance' table with computed punctuality fields.
  pgm.addColumns('attendance', {
    punctuality_status: {
      type: 'varchar(20)',
      default: "'ON_TIME'",
      comment: 'ON_TIME | LATE | EARLY | HALF_DAY | ABSENT',
    },
    late_by_minutes: {
      type: 'integer',
      default: 0,
    },
    working_minutes: {
      type: 'integer',
      default: 0,
    },
    reporting_time_used: {
      type: 'time',
      comment: 'The configured reporting time that was used to compute punctuality on this day',
    },
  });

  pgm.addIndex('attendance', ['person_id', 'work_date']);
  pgm.addIndex('attendance', ['punctuality_status']);

  // ─── 3. LEAVE REQUESTS — Add Reviewer & Cancellation Columns ─────────────────
  // Extends existing 'leave_requests' table with workflow tracking.
  pgm.addColumns('leave_requests', {
    reviewer_remark:  { type: 'text' },
    reviewed_at:      { type: 'timestamptz' },
    cancelled_at:     { type: 'timestamptz' },
    cancelled_by:     { type: 'uuid', references: '"persons"', onDelete: 'SET NULL' },
  });

  pgm.addIndex('leave_requests', ['status']);
  pgm.addIndex('leave_requests', ['person_id', 'start_date']);

  // ─── 4. FINANCIAL RECORDS ────────────────────────────────────────────────────
  // Generic financial record table: salary, bonus, deduction, payslip etc.
  // CEO and Org Admin see all. Employees see only their own via /finance/records/me.
  pgm.createTable('financial_records', {
    id:              { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
    organization_id: { type: 'uuid', notNull: true, references: '"organizations"', onDelete: 'CASCADE' },
    person_id:       { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'CASCADE' },
    record_type:     {
      type: 'varchar(20)',
      notNull: true,
      comment: 'SALARY | BONUS | DEDUCTION | PAYSLIP | OTHER',
    },
    period_month:    { type: 'smallint', check: 'period_month BETWEEN 1 AND 12' },
    period_year:     { type: 'smallint' },
    amount:          { type: 'numeric(12,2)', notNull: true },
    currency:        { type: 'char(3)', default: "'INR'" },
    description:     { type: 'text' },
    metadata:        { type: 'jsonb', default: pgm.func("'{}'") },
    created_by:      { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'RESTRICT' },
    created_at:      { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    updated_at:      { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.addIndex('financial_records', ['organization_id', 'person_id']);
  pgm.addIndex('financial_records', ['organization_id', 'period_year', 'period_month']);
  pgm.addIndex('financial_records', ['person_id', 'record_type']);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  console.warn('Destructive rollback disabled for migration 012.');
};
