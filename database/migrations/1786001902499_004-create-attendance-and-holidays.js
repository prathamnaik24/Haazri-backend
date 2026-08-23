/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
    // 1. HOLIDAYS (Company-wide days off)
    pgm.createTable('holidays', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: { type: 'uuid', notNull: true, references: '"organizations"', onDelete: 'CASCADE' },
      name: { type: 'varchar(255)', notNull: true }, // e.g., 'Diwali', 'New Year'
      holiday_date: { type: 'date', notNull: true },
      is_active: { type: 'boolean', default: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 2. ATTENDANCE (Daily logs)
    pgm.createTable('attendance', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      person_id: { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'CASCADE' },
      work_date: { type: 'date', notNull: true },
      check_in_time: { type: 'timestamptz' },
      check_out_time: { type: 'timestamptz' },
      status: { type: 'varchar(50)', notNull: true, default: 'Present' }, // e.g., 'Present', 'Absent', 'Half-Day'
      metadata: { type: 'jsonb', default: '{}' }, // Perfect for storing things like GPS coordinates, IP addresses, or anomaly flags
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // Safety Constraint: Ensure an employee only gets ONE attendance row per day
    pgm.addConstraint('attendance', 'unique_person_work_date', {
      unique: ['person_id', 'work_date']
    });
  };
  
  /**
   * @param {import("node-pg-migrate").MigrationBuilder} pgm
   */
  export const down = (pgm) => {
    console.warn("Destructive rollback disabled: Tables 'attendance' and 'holidays' were not dropped.");
  };