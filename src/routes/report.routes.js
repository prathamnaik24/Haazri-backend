import { Router } from 'express';
import { getAttendanceReport, getLeaveReport } from '../controllers/admin/report.controller.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/attendance', getAttendanceReport);
router.get('/leaves', getLeaveReport);

export default router;
