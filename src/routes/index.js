import { Router } from 'express';
import healthRouter from './health.js';
import authRouter from './auth.routes.js';
import orgRouter from './org.routes.js';
import attendanceRouter from './attendance.routes.js';
import leaveRouter from './leave.routes.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/org', orgRouter);
router.use('/attendance', attendanceRouter);
router.use('/leaves', leaveRouter);

export default router;
