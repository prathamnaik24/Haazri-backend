/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
    // 1. Enable the ltree extension for the database (if not already enabled)
    pgm.createExtension('ltree', { ifNotExists: true });
  
    // 2. Create the POSITIONS table (The Hierarchy)
    pgm.createTable('positions', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"organizations"', 
        onDelete: 'CASCADE' 
      },
      department_id: { 
        type: 'uuid', 
        references: '"departments"', 
        onDelete: 'SET NULL' // A position might be org-wide, so this can be null
      },
      parent_id: { 
        type: 'uuid', 
        references: '"positions"', 
        onDelete: 'SET NULL' // Adjacency list fallback for easy mutability
      },
      title: { type: 'varchar(255)', notNull: true },
      path: { type: 'ltree', notNull: true }, // The materialized path (e.g., 'ceo.cto.dev')
      is_active: { type: 'boolean', default: true },
      created_at: { 
        type: 'timestamptz', 
        notNull: true, 
        default: pgm.func('current_timestamp') 
      },
      updated_at: { 
        type: 'timestamptz', 
        notNull: true, 
        default: pgm.func('current_timestamp') 
      },
    });
  
    // Create a GIST index on the ltree path to make hierarchy queries blazing fast
    pgm.createIndex('positions', 'path', { method: 'gist' });
  
    // 3. Create the PERSONS table (Core Identity)
    pgm.createTable('persons', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: { 
        type: 'uuid', 
        notNull: true, 
        references: '"organizations"', 
        onDelete: 'CASCADE' 
      },
      first_name: { type: 'varchar(100)', notNull: true },
      last_name: { type: 'varchar(100)', notNull: true },
      email: { type: 'varchar(255)', notNull: true, unique: true },
      password_hash: { type: 'varchar(255)', notNull: true },
      is_active: { type: 'boolean', default: true },
      created_at: { 
        type: 'timestamptz', 
        notNull: true, 
        default: pgm.func('current_timestamp') 
      },
      updated_at: { 
        type: 'timestamptz', 
        notNull: true, 
        default: pgm.func('current_timestamp') 
      },
    });
  };
  
  /**
   * @param {import("node-pg-migrate").MigrationBuilder} pgm
   */
  export const down = (pgm) => {
    // Complying with Pratham's README: No destructive drops allowed.
    console.warn("Destructive rollback disabled: Tables 'persons' and 'positions' were not dropped.");
  };