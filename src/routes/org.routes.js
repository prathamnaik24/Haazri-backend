import { Router } from 'express';
import {
  createEmployee,
  listEmployees,
  getEmployeeById,
  resendInvite,
  updateEmployee,
} from '../controllers/org.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';

const router = Router();

// Apply auth and tenant guards globally to all org routes
router.use(requireAuth);
router.use(requireTenant);

/**
 * /api/org/employees
 */
router.post('/employees', createEmployee);
router.get('/employees', listEmployees);
router.get('/employees/:id', getEmployeeById);
router.patch('/employees/:id', updateEmployee);
router.post('/employees/:id/resend-invite', resendInvite);

export default router;
