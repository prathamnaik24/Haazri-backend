/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE SEQUENCE IF NOT EXISTS workday_id_seq
      START WITH 1
      INCREMENT BY 1
      NO MINVALUE
      NO MAXVALUE
      CACHE 1;
  `);

  pgm.addColumn('persons', {
    workday_id: { type: 'varchar(50)' },
  });

  pgm.sql(`
    UPDATE persons
    SET workday_id = 'WD-' || LPAD(nextval('workday_id_seq')::text, 6, '0')
    WHERE workday_id IS NULL;
  `);

  pgm.sql(`
    ALTER TABLE persons
      ALTER COLUMN workday_id SET DEFAULT ('WD-' || LPAD(nextval('workday_id_seq')::text, 6, '0'));
  `);

  pgm.addConstraint('persons', 'persons_workday_id_unique', {
    unique: ['workday_id'],
  });

  pgm.alterColumn('persons', 'workday_id', {
    type: 'varchar(50)',
    notNull: true,
  });
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropConstraint('persons', 'persons_workday_id_unique');
  pgm.dropColumn('persons', 'workday_id');
  pgm.sql(`DROP SEQUENCE IF EXISTS workday_id_seq;`);
};
