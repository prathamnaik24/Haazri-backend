import { Router } from 'express';
import {
  checkIn,
  checkOut,
  getMyHistory,
  getMySummary,
  getTeamHistory,
  getDailyReport,
  getRangeReport,
} from '../controllers/attendance.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';
import { requireRole } from '../middlewares/requireRole.js';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// Employee-level
router.post('/check-in',      checkIn);
router.post('/check-out',     checkOut);
router.get('/me',             getMyHistory);
router.get('/me/summary',     getMySummary);

// Manager / HR / Admin
router.get('/team',           getTeamHistory);

// HR / Org Admin reports
router.get('/reports/daily',  requireRole('Org Admin', 'HR Manager'), getDailyReport);
router.get('/reports/range',  requireRole('Org Admin', 'HR Manager'), getRangeReport);

export default router;
