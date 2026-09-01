import { Router } from 'express';
import {
  getMyCompensation,
  getEmployeeCompensation,
  upsertSalaryStructure,
  getComponents,
  addComponent,
  updateComponent,
  deleteComponent,
  getIncrements,
  getMyIncrements,
  proposeIncrement,
  reviewIncrement,
} from '../controllers/compensation.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';
import { requireRole } from '../middlewares/requireRole.js';

const router = Router();

router.use(requireAuth);
router.use(requireTenant);

// Self-view routes (Must be placed before parameterized /:id routes)
router.get('/me', getMyCompensation);
router.get('/increments/me', getMyIncrements);

// Increment workflow routes
router.get('/increments', requireRole('Org Admin', 'HR Manager', 'CEO'), getIncrements);
router.post('/increments', requireRole('Org Admin', 'HR Manager', 'CEO'), proposeIncrement);
router.patch('/increments/:id/status', requireRole('Org Admin', 'HR Manager', 'CEO'), reviewIncrement);

// Employee compensation & base salary structure
router.get('/person/:id', requireRole('Org Admin', 'HR Manager', 'CEO'), getEmployeeCompensation);
router.post('/person/:id/structure', requireRole('Org Admin', 'HR Manager'), upsertSalaryStructure);

// Salary components
router.get('/person/:id/components', requireRole('Org Admin', 'HR Manager', 'CEO'), getComponents);
router.post('/person/:id/components', requireRole('Org Admin', 'HR Manager'), addComponent);
router.patch('/components/:id', requireRole('Org Admin', 'HR Manager'), updateComponent);
router.delete('/components/:id', requireRole('Org Admin', 'HR Manager'), deleteComponent);

export default router;
