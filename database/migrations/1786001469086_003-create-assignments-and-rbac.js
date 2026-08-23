/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
    // 1. POSITION ASSIGNMENTS (Linking persons to the hierarchy)
    pgm.createTable('position_assignments', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      person_id: { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'CASCADE' },
      position_id: { type: 'uuid', notNull: true, references: '"positions"', onDelete: 'CASCADE' },
      is_primary: { type: 'boolean', default: true }, // Crucial for the Auth Factory routing
      start_date: { type: 'date', notNull: true, default: pgm.func('current_date') },
      end_date: { type: 'date' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 2. ROLES (Org-level access categories like 'HR', 'System Admin')
    pgm.createTable('roles', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: { type: 'uuid', notNull: true, references: '"organizations"', onDelete: 'CASCADE' },
      name: { type: 'varchar(100)', notNull: true },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
      updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 3. PERMISSIONS (Specific capabilities)
    pgm.createTable('permissions', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      name: { type: 'varchar(100)', notNull: true, unique: true }, // e.g., 'approve_leaves', 'view_reports'
      description: { type: 'varchar(255)' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 4. ROLE PERMISSIONS (Mapping permissions to roles)
    pgm.createTable('role_permissions', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      role_id: { type: 'uuid', notNull: true, references: '"roles"', onDelete: 'CASCADE' },
      permission_id: { type: 'uuid', notNull: true, references: '"permissions"', onDelete: 'CASCADE' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  
    // 5. PERSON ROLES (Assigning those roles to specific users)
    pgm.createTable('person_roles', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      person_id: { type: 'uuid', notNull: true, references: '"persons"', onDelete: 'CASCADE' },
      role_id: { type: 'uuid', notNull: true, references: '"roles"', onDelete: 'CASCADE' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') },
    });
  };
  
  /**
   * @param {import("node-pg-migrate").MigrationBuilder} pgm
   */
  export const down = (pgm) => {
    console.warn("Destructive rollback disabled: RBAC and assignment tables were not dropped.");
  };