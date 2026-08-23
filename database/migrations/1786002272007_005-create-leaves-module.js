/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
    // 1. LEAVE TYPES (e.g., Sick, Casual, Maternity)
    pgm.createTable('leave_types', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: { type: 'uuid', notNull: true, references: '"organizations"', onDelete: 'CASCADE' },
      name: { type: 'varchar(100)', notNull: true },
      is_paid: { type: 'boolean', default: true },
      is_active: { type: 'boolean', default: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 2. LEAVE POLICIES (Rules for each type of leave)
    pgm.createTable('leave_policies', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      leave_type_id: { type: 'uuid', notNull: true, references: '"leave_types"', onDelete: 'CASCADE' },
      days_allowed: { type: 'numeric(5,2)', notNull: true }, // numeric handles half-days (e.g., 12.5)
      carry_forward_allowed: { type: 'boolean', default: false },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 3. LEAVE BALANCES (Tracking how many days an employee has left this year)
    pgm.createTable('leave_balances', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      person_id: { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'CASCADE' },
      leave_type_id: { type: 'uuid', notNull: true, references: '"leave_types"', onDelete: 'CASCADE' },
      balance: { type: 'numeric(5,2)', notNull: true, default: 0 },
      year: { type: 'integer', notNull: true }, // e.g., 2026
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // Safety Constraint: An employee only gets one balance record per leave type, per year.
    pgm.addConstraint('leave_balances', 'unique_person_leave_year', {
      unique: ['person_id', 'leave_type_id', 'year']
    });
  
    // 4. LEAVE REQUESTS (The workflow for asking for time off)
    pgm.createTable('leave_requests', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      person_id: { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'CASCADE' },
      leave_type_id: { type: 'uuid', notNull: true, references: '"leave_types"', onDelete: 'CASCADE' },
      start_date: { type: 'date', notNull: true },
      end_date: { type: 'date', notNull: true },
      status: { type: 'varchar(50)', notNull: true, default: 'Pending' }, // Pending, Approved, Rejected
      reason: { type: 'text' },
      reviewer_id: { type: 'uuid', references: '"persons"', onDelete: 'SET NULL' }, // The manager who approves/rejects
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  };
  
  /**
   * @param {import("node-pg-migrate").MigrationBuilder} pgm
   */
  export const down = (pgm) => {
    console.warn("Destructive rollback disabled: Leaves tables were not dropped.");
  };