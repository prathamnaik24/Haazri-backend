/**
 * Migration 012: Add hierarchy view and management permissions
 *
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
  // 1. Insert permissions view_hierarchy and manage_hierarchy
  pgm.sql(`
    INSERT INTO permissions (name, description) VALUES
    ('view_hierarchy', 'Can view organization hierarchy and org chart'),
    ('manage_hierarchy', 'Can move employees, positions and reorganize hierarchy')
    ON CONFLICT (name) DO NOTHING;
  `);

  // 2. Map view_hierarchy to all existing roles
  pgm.sql(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r, permissions p
    WHERE p.name = 'view_hierarchy'
    ON CONFLICT DO NOTHING;
  `);

  // 3. Map manage_hierarchy to 'Org Admin' and 'HR Manager' roles
  pgm.sql(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r, permissions p
    WHERE p.name = 'manage_hierarchy' AND r.name IN ('Org Admin', 'HR Manager')
    ON CONFLICT DO NOTHING;
  `);
};

/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const down = (pgm) => {
  // Cleanup mappings first, then delete permissions
  pgm.sql(`
    DELETE FROM role_permissions WHERE permission_id IN (
      SELECT id FROM permissions WHERE name IN ('view_hierarchy', 'manage_hierarchy')
    );
    DELETE FROM permissions WHERE name IN ('view_hierarchy', 'manage_hierarchy');
  `);
};
