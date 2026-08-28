import { Router } from 'express';
import {
  requestLeave,
  getMyLeaves,
  cancelMyLeave,
  getTeamPendingLeaves,
  actionLeaveRequest,
  getHRLeaves,
  getLeaveTypes,
} from '../controllers/leave.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';
import { requireRole } from '../middlewares/requireRole.js';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// Any authenticated employee
router.get('/types',                     getLeaveTypes);
router.post('/request',                  requestLeave);
router.get('/me',                        getMyLeaves);
router.delete('/request/:id',            cancelMyLeave);

// Manager / Org Admin — approve / reject team leaves
router.get('/team/pending',              getTeamPendingLeaves);
router.patch('/request/:id/action',      actionLeaveRequest);

// HR / Org Admin — read-only org-wide view (no reason field)
router.get('/hr',                        requireRole('HR Manager', 'Org Admin'), getHRLeaves);

export default router;
