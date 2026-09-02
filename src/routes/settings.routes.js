import { Router } from 'express';
import { getReportingTime, setReportingTime } from '../controllers/settings.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';
import { requireRole } from '../middlewares/requireRole.js';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

router.get('/reporting-time', getReportingTime);
router.put('/reporting-time', requireRole('Org Admin'), setReportingTime);

export default router;
