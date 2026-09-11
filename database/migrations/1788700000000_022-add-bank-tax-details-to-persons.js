/**
 * Migration 022: Add bank and tax details to persons table
 *
 * Adds optional columns for employee banking and tax information:
 * - bank_name (varchar 255)
 * - account_number (varchar 100)
 * - ifsc_code (varchar 50)
 * - pan_number (varchar 50)
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  pgm.addColumns('persons', {
    bank_name: {
      type: 'varchar(255)',
      notNull: false,
    },
    account_number: {
      type: 'varchar(100)',
      notNull: false,
    },
    ifsc_code: {
      type: 'varchar(50)',
      notNull: false,
    },
    pan_number: {
      type: 'varchar(50)',
      notNull: false,
    },
  });
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  pgm.dropColumns('persons', ['bank_name', 'account_number', 'ifsc_code', 'pan_number']);
};
