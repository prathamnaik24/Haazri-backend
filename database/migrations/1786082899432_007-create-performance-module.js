/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
    // 1. Performance Cycles (e.g. "Q1 2026", "Annual 2026")
    pgm.createTable('performance_cycles', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"organizations"', 
        onDelete: 'CASCADE' 
      },
      name: { type: 'varchar(255)', notNull: true },
      start_date: { type: 'date', notNull: true },
      end_date: { type: 'date', notNull: true },
      status: { type: 'varchar(50)', default: 'draft' }, // draft, active, closed
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 2. Performance Goals (Targets set for a person in a cycle)
    pgm.createTable('performance_goals', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"organizations"', 
        onDelete: 'CASCADE' 
      },
      person_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"persons"', 
        onDelete: 'CASCADE' 
      },
      cycle_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"performance_cycles"', 
        onDelete: 'CASCADE' 
      },
      title: { type: 'varchar(255)', notNull: true },
      description: { type: 'text' },
      weightage: { type: 'numeric(5,2)' }, // percentage weight
      status: { type: 'varchar(50)', default: 'pending' }, // pending, in_progress, achieved, missed
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 3. Performance Reviews (Manager's assessment of a person)
    pgm.createTable('performance_reviews', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"organizations"', 
        onDelete: 'CASCADE' 
      },
      person_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"persons"', 
        onDelete: 'CASCADE' 
      },
      reviewer_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"persons"', 
        onDelete: 'CASCADE' 
      },
      cycle_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"performance_cycles"', 
        onDelete: 'CASCADE' 
      },
      rating: { type: 'numeric(5,2)' }, // numerical score
      feedback: { type: 'text' },
      status: { type: 'varchar(50)', default: 'draft' }, // draft, submitted, approved
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  };
  
  /**
   * @param {import("node-pg-migrate").MigrationBuilder} pgm
   */
  export const down = (pgm) => {
    console.warn("Destructive rollback disabled: Performance tables were not dropped.");
  };
