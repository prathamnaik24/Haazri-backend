/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
    // 1. Create the organizations table
    pgm.createTable('organizations', {
        id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
        name: { type: 'varchar(255)', notNull: true },
        slug: { type: 'varchar(255)', unique: true },
        type: { type: 'varchar(100)', notNull: true }, // e.g., 'Corporate', 'Educational'
        is_active: { type: 'boolean', default: true },
        // JSONB for flexible custom fields — different org types have different attributes
        metadata: { type: 'jsonb', default: '{}' },
        created_at: {
          type: 'timestamptz', // timezone-aware — orgs can span multiple timezones
          notNull: true,
          default: pgm.func('current_timestamp'),
        },
        updated_at: {
          type: 'timestamptz',
          notNull: true,
          default: pgm.func('current_timestamp'),
        },
      });
    // 2. Create the departments table
    pgm.createTable('departments', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: {
        type: 'uuid',
        notNull: true,
        references: '"organizations"',
        onDelete: 'RESTRICT', // Prevents deleting an org if it has departments
      },
      name: { type: 'varchar(255)', notNull: true },
      is_active: { type: 'boolean', default: true },
      created_at: {
        type: 'timestamptz', // timezone-aware
        notNull: true,
        default: pgm.func('current_timestamp'),
      },
    });
  };
  
  /**
   * @param {import("node-pg-migrate").MigrationBuilder} pgm
   */
  export const down = (pgm) => {
    // Pratham's README strictly forbids DROP TABLE to prevent accidental data loss.
    // In a strict append-only database, 'down' migrations for table creation are often left empty,
    // or they just raise a warning that destructive rollbacks are disabled.
    console.warn("Destructive rollback disabled: Tables 'departments' and 'organizations' were not dropped.");
  };