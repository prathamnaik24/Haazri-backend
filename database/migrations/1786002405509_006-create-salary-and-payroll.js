/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
    // 1. SALARY STRUCTURES (Base pay and fixed allowances for a person)
    pgm.createTable('salary_structures', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      person_id: { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'CASCADE' },
      base_salary: { type: 'numeric(12,2)', notNull: true }, // e.g., 50000.00
      allowances: { type: 'numeric(12,2)', default: 0.00 },
      effective_from: { type: 'date', notNull: true, default: pgm.func('current_date') },
      is_active: { type: 'boolean', default: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 2. SALARY DEDUCTIONS (Taxes, unpaid leaves, or penalties)
    pgm.createTable('salary_deductions', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      person_id: { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'CASCADE' },
      name: { type: 'varchar(100)', notNull: true }, // e.g., 'Tax', 'Unpaid Leave'
      amount: { type: 'numeric(12,2)', notNull: true },
      deduction_date: { type: 'date', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 3. PAYROLL (The actual monthly payout record generated for an employee)
    pgm.createTable('payroll', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      person_id: { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'CASCADE' },
      month: { type: 'integer', notNull: true }, // 1 to 12
      year: { type: 'integer', notNull: true }, // e.g., 2026
      total_earnings: { type: 'numeric(12,2)', notNull: true },
      total_deductions: { type: 'numeric(12,2)', notNull: true },
      net_salary: { type: 'numeric(12,2)', notNull: true }, // Earnings - Deductions
      status: { type: 'varchar(50)', notNull: true, default: 'Pending' }, // Pending, Processed, Paid
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // Safety Constraint: Ensure an employee only gets one main payroll record per month/year
    pgm.addConstraint('payroll', 'unique_person_payroll_month', {
      unique: ['person_id', 'month', 'year']
    });
  };
  
  /**
   * @param {import("node-pg-migrate").MigrationBuilder} pgm
   */
  export const down = (pgm) => {
    console.warn("Destructive rollback disabled: Salary and payroll tables were not dropped.");
  };