import { db } from '../../db/index.js';

export class AuditService {
  static async getAuditLogs(orgId, limit = 50, offset = 0) {
    const res = await db.query(`
      SELECT 
        a.id, 
        a.entity_type, 
        a.entity_id, 
        a.action, 
        a.old_data, 
        a.new_data, 
        a.reason, 
        a.created_at,
        p.first_name, 
        p.last_name
      FROM audit_logs a
      LEFT JOIN persons p ON a.changed_by = p.id
      WHERE a.organization_id = $1 
      ORDER BY a.created_at DESC 
      LIMIT $2 OFFSET $3
    `, [orgId, limit, offset]);
    return res.rows;
  }
}
