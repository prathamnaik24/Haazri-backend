/**
 * Compensation & Payroll Structure
 *
 * Adds:
 * 1. Detailed salary component configuration
 * 2. Salary increment proposal/approval workflow
 * 3. Detailed monthly payroll information
 * 4. Payslip PDF metadata
 *
 * Existing tables such as salary_structures, payroll and
 * financial_records are preserved and extended where required.
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */

export const up = (pgm) => {
  // ============================================================
  // 1. SALARY COMPONENT CONFIGURATION
  // ============================================================
  //
  // Defines how an employee's salary is broken down.
  //
  // calculation_type:
  //   FIXED       -> fixed monthly amount
  //   PERCENTAGE  -> percentage based calculation
  //
  // percentage_base:
  //   WAGE        -> percentage of monthly wage
  //   BASIC       -> percentage of basic salary
  //

  pgm.createTable('salary_components', {
    id: {
      type: 'uuid',
      default: pgm.func('gen_random_uuid()'),
      primaryKey: true,
    },

    person_id: {
      type: 'uuid',
      notNull: true,
      references: '"persons"',
      onDelete: 'CASCADE',
    },

    component_type: {
      type: 'varchar(50)',
      notNull: true,
      comment:
        'BASIC | HRA | STANDARD_ALLOWANCE | PERFORMANCE_BONUS | LTA | FIXED_ALLOWANCE | STOCK_EQUITY',
    },

    calculation_type: {
      type: 'varchar(20)',
      notNull: true,
      comment: 'FIXED | PERCENTAGE',
    },

    percentage_base: {
      type: 'varchar(20)',
      comment: 'WAGE | BASIC',
    },

    configured_value: {
      type: 'numeric(12,2)',
      notNull: true,
      comment:
        'Fixed amount or percentage value depending on calculation_type',
    },

    calculated_amount: {
      type: 'numeric(12,2)',
      notNull: true,
      default: 0,
    },

    is_active: {
      type: 'boolean',
      default: true,
    },

    effective_from: {
      type: 'date',
      notNull: true,
      default: pgm.func('current_date'),
    },

    created_by: {
      type: 'uuid',
      references: '"persons"',
      onDelete: 'SET NULL',
    },

    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },

    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.addIndex('salary_components', ['person_id']);
  pgm.addIndex('salary_components', ['person_id', 'component_type']);
  pgm.addIndex('salary_components', ['person_id', 'is_active']);

  pgm.addConstraint('salary_components', 'salary_components_calculation_type_check', {
    check: "calculation_type IN ('FIXED', 'PERCENTAGE')",
  });

  pgm.addConstraint('salary_components', 'salary_components_percentage_base_check', {
    check: "percentage_base IS NULL OR percentage_base IN ('WAGE', 'BASIC')",
  });

  pgm.addConstraint('salary_components', 'salary_components_value_check', {
    check: 'configured_value >= 0 AND calculated_amount >= 0',
  });

  // ============================================================
  // 2. SALARY INCREMENT WORKFLOW
  // ============================================================

  pgm.createTable('salary_increments', {
    id: {
      type: 'uuid',
      default: pgm.func('gen_random_uuid()'),
      primaryKey: true,
    },

    person_id: {
      type: 'uuid',
      notNull: true,
      references: '"persons"',
      onDelete: 'CASCADE',
    },

    current_salary: {
      type: 'numeric(12,2)',
      notNull: true,
    },

    proposed_salary: {
      type: 'numeric(12,2)',
      notNull: true,
    },

    increment_percentage: {
      type: 'numeric(7,2)',
    },

    reason: {
      type: 'text',
    },

    status: {
      type: 'varchar(30)',
      notNull: true,
      default: 'PENDING',
      comment: 'PENDING | APPROVED | REJECTED | CANCELLED',
    },

    proposed_by: {
      type: 'uuid',
      notNull: true,
      references: '"persons"',
      onDelete: 'RESTRICT',
    },

    reviewed_by: {
      type: 'uuid',
      references: '"persons"',
      onDelete: 'SET NULL',
    },

    reviewer_comment: {
      type: 'text',
    },

    effective_from: {
      type: 'date',
    },

    reviewed_at: {
      type: 'timestamptz',
    },

    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },

    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.addIndex('salary_increments', ['person_id']);
  pgm.addIndex('salary_increments', ['status']);
  pgm.addIndex('salary_increments', ['proposed_by']);

  pgm.addConstraint('salary_increments', 'salary_increments_status_check', {
    check:
      "status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')",
  });

  pgm.addConstraint('salary_increments', 'salary_increments_salary_check', {
    check: 'current_salary >= 0 AND proposed_salary >= 0',
  });

  // ============================================================
  // 3. EXTEND EXISTING PAYROLL TABLE
  // ============================================================
  //
  // The existing payroll table already stores:
  // total_earnings
  // total_deductions
  // net_salary
  //
  // Add detailed payroll information needed by the new feature.
  //

  pgm.addColumns('payroll', {
    basic_salary: {
      type: 'numeric(12,2)',
      default: 0,
    },

    hra: {
      type: 'numeric(12,2)',
      default: 0,
    },

    standard_allowance: {
      type: 'numeric(12,2)',
      default: 0,
    },

    performance_bonus: {
      type: 'numeric(12,2)',
      default: 0,
    },

    leave_travel_allowance: {
      type: 'numeric(12,2)',
      default: 0,
    },

    fixed_allowance: {
      type: 'numeric(12,2)',
      default: 0,
    },

    stock_equity: {
      type: 'numeric(12,2)',
      default: 0,
    },

    tds: {
      type: 'numeric(12,2)',
      default: 0,
    },

    provident_fund: {
      type: 'numeric(12,2)',
      default: 0,
    },

    professional_tax: {
      type: 'numeric(12,2)',
      default: 0,
    },

    other_deductions: {
      type: 'numeric(12,2)',
      default: 0,
    },

    working_days: {
      type: 'integer',
    },

    paid_days: {
      type: 'integer',
    },

    payment_date: {
      type: 'date',
    },

    payment_reference: {
      type: 'varchar(100)',
    },

    component_breakdown: {
      type: 'jsonb',
      default: pgm.func("'{}'::jsonb"),
    },
  });

  pgm.addIndex('payroll', ['person_id', 'year', 'month'], { ifNotExists: true });

  // ============================================================
  // 4. PAYSLIPS
  // ============================================================
  //
  // Stores the generated/uploaded PDF payslip information.
  // The actual PDF can be stored using the application's
  // existing file/storage mechanism.
  //

  pgm.createTable('payslips', {
    id: {
      type: 'uuid',
      default: pgm.func('gen_random_uuid()'),
      primaryKey: true,
    },

    person_id: {
      type: 'uuid',
      notNull: true,
      references: '"persons"',
      onDelete: 'CASCADE',
    },

    payroll_id: {
      type: 'uuid',
      references: '"payroll"',
      onDelete: 'CASCADE',
    },

    month: {
      type: 'integer',
      notNull: true,
    },

    year: {
      type: 'integer',
      notNull: true,
    },

    file_name: {
      type: 'varchar(255)',
      notNull: true,
    },

    file_url: {
      type: 'text',
      notNull: true,
    },

    file_type: {
      type: 'varchar(50)',
      notNull: true,
      default: 'application/pdf',
    },

    file_size: {
      type: 'bigint',
    },

    generated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },

    uploaded_by: {
      type: 'uuid',
      references: '"persons"',
      onDelete: 'SET NULL',
    },

    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.addIndex('payslips', ['person_id']);
  pgm.addIndex('payslips', ['person_id', 'year', 'month']);

  pgm.addConstraint('payslips', 'payslips_month_check', {
    check: 'month BETWEEN 1 AND 12',
  });

  pgm.addConstraint('payslips', 'payslips_pdf_check', {
    check: "file_type = 'application/pdf'",
  });

  // One payslip per employee per month/year.
  pgm.addConstraint('payslips', 'unique_person_payslip_month', {
    unique: ['person_id', 'month', 'year'],
  });
};

export const down = (pgm) => {
  // Remove only objects created by this migration.
  pgm.dropTable('payslips');
  pgm.dropTable('salary_increments');
  pgm.dropTable('salary_components');

  pgm.dropColumns('payroll', [
    'basic_salary',
    'hra',
    'standard_allowance',
    'performance_bonus',
    'leave_travel_allowance',
    'fixed_allowance',
    'stock_equity',
    'tds',
    'provident_fund',
    'professional_tax',
    'other_deductions',
    'working_days',
    'paid_days',
    'payment_date',
    'payment_reference',
    'component_breakdown',
  ]);
};