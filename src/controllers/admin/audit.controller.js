import { AuditService } from '../../services/admin/AuditService.js';

export const getAuditLogs = async (req, res) => {
  try {
    const { limit, offset } = req.query;
    const logs = await AuditService.getAuditLogs(
      req.user.organization_id, 
      limit ? parseInt(limit) : 50, 
      offset ? parseInt(offset) : 0
    );
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
