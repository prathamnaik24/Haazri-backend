import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';
import { requireRole } from '../middlewares/requireRole.js';
import {
  submitResignation,
  getOwnResignations,
  getManagerResignations,
  managerAction,
  getHRResignations,
  hrAction,
  completeResignation,
  getResignationById,
} from '../controllers/resignation.controller.js';

const router = Router();

// Protect all resignation routes with authentication and tenant resolution
router.use(requireAuth);
router.use(requireTenant);

// Employee routes
router.post('/', submitResignation);
router.get('/my', getOwnResignations);

// Manager review routes
router.get('/manager', getManagerResignations);
router.post('/:id/manager-action', managerAction);

// HR review routes (Restricted to HR Manager or Org Admin)
router.get('/hr', requireRole('Org Admin', 'HR Manager'), getHRResignations);
router.post('/:id/hr-action', requireRole('Org Admin', 'HR Manager'), hrAction);
router.post('/:id/complete', requireRole('Org Admin', 'HR Manager'), completeResignation);

// Detail route
router.get('/:id', getResignationById);

export default router;
