import { Router } from 'express';
import healthRouter from './health.js';
import authRouter from './auth.routes.js';
import orgRouter from './org.routes.js';
import attendanceRouter from './attendance.routes.js';
import leaveRouter from './leave.routes.js';

import roleRouter from './role.routes.js';
import orgStructureRouter from './orgStructure.routes.js';
import reportRouter from './report.routes.js';
import auditRouter from './audit.routes.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/org', orgRouter);
router.use('/attendance', attendanceRouter);
router.use('/leaves', leaveRouter);

router.use('/admin/roles', roleRouter);
router.use('/admin/org-structure', orgStructureRouter);
router.use('/admin/reports', reportRouter);
router.use('/admin/audit', auditRouter);

export default router;
