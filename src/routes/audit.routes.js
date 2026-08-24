import { Router } from 'express';
import { getAuditLogs } from '../controllers/admin/audit.controller.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/', getAuditLogs);

export default router;
