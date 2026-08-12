import { Router } from 'express';
import {
  checkIn,
  checkOut,
  getMyHistory,
  getTeamHistory,
} from '../controllers/attendance.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';

const router = Router();

// Apply auth and tenant guards globally to all attendance endpoints
router.use(requireAuth);
router.use(requireTenant);

router.post('/check-in', checkIn);
router.post('/check-out', checkOut);
router.get('/me', getMyHistory);
router.get('/team', getTeamHistory);

export default router;
