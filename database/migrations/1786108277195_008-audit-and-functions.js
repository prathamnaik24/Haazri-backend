/**
 * @param {import("node-pg-migrate").MigrationBuilder} pgm
 */
export const up = (pgm) => {
    // 1. Create audit_logs table for tracking history (who moved where when why)
    pgm.createTable('audit_logs', {
      id: { type: 'uuid', default: pgm.func('gen_random_uuid()'), primaryKey: true },
      organization_id: { type: 'uuid', references: '"organizations"', onDelete: 'CASCADE' },
      entity_type: { type: 'varchar(100)', notNull: true }, // e.g. 'position', 'person'
      entity_id: { type: 'uuid', notNull: true },
      action: { type: 'varchar(50)', notNull: true }, // 'CREATE', 'UPDATE', 'DELETE', 'MOVE'
      old_data: { type: 'jsonb' },
      new_data: { type: 'jsonb' },
      changed_by: { type: 'uuid', references: '"persons"', onDelete: 'SET NULL' },
      reason: { type: 'text' },
      created_at: { type: 'timestamptz', notNull: true, default: pgm.func('current_timestamp') }
    });
  
    // 2. Add JSONB metadata to persons (for dynamic profiles like national_ids)
    pgm.addColumn('persons', {
      metadata: { type: 'jsonb', default: '{}' }
    });
  
    // Add GIN indexes for fast querying inside the JSON structures
    pgm.createIndex('persons', 'metadata', { method: 'gin' });
    pgm.createIndex('organizations', 'metadata', { method: 'gin' });
  
    // 3. Create the move_position_subtree PL/pgSQL function
    // This updates the target node AND all descendants instantly, and logs the action
    pgm.sql(`
      CREATE OR REPLACE FUNCTION move_position_subtree(
        p_target_id UUID,
        p_new_parent_id UUID,
        p_reason TEXT DEFAULT 'Hierarchy Reorganization',
        p_changed_by UUID DEFAULT NULL
      )
      RETURNS void AS $$
      DECLARE
        v_old_path ltree;
        v_old_parent_id UUID;
        v_new_parent_path ltree;
        v_new_path ltree;
        v_org_id UUID;
      BEGIN
        -- 1. Get the target node's current path, parent, and org
        SELECT path, parent_id, organization_id INTO v_old_path, v_old_parent_id, v_org_id
        FROM positions WHERE id = p_target_id;
        
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Target position % not found', p_target_id;
        END IF;
  
        -- 2. Get the new parent's path
        SELECT path INTO v_new_parent_path
        FROM positions WHERE id = p_new_parent_id;
  
        IF NOT FOUND THEN
          RAISE EXCEPTION 'New parent position % not found', p_new_parent_id;
        END IF;
  
        -- 3. Prevent cyclic dependencies (cannot move a node to its own descendant)
        IF v_new_parent_path <@ v_old_path THEN
          RAISE EXCEPTION 'Cannot move a position to its own descendant';
        END IF;
  
        -- 4. Calculate new path for target node (append the target's slug to new parent path)
        v_new_path := v_new_parent_path || subpath(v_old_path, -1);
  
        -- 5. Update target and all descendants
        UPDATE positions
        SET 
          parent_id = CASE WHEN id = p_target_id THEN p_new_parent_id ELSE parent_id END,
          path = v_new_path || subpath(path, nlevel(v_old_path)),
          updated_at = current_timestamp
        WHERE path <@ v_old_path;
  
        -- 6. Log the action in audit_logs
        INSERT INTO audit_logs (
          organization_id, entity_type, entity_id, action, old_data, new_data, changed_by, reason
        ) VALUES (
          v_org_id, 
          'position', 
          p_target_id, 
          'MOVE_SUBTREE',
          jsonb_build_object('path', v_old_path::text, 'parent_id', v_old_parent_id),
          jsonb_build_object('path', v_new_path::text, 'parent_id', p_new_parent_id),
          p_changed_by,
          p_reason
        );
      END;
      $$ LANGUAGE plpgsql;
    `);
  };
  
  /**
   * @param {import("node-pg-migrate").MigrationBuilder} pgm
   */
  export const down = (pgm) => {
    console.warn("Destructive rollback disabled: Audit logs and functions were not dropped.");
  };
