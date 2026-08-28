import { Router } from 'express';
import {
  createEmployee,
  listEmployees,
  getEmployeeById,
  resendInvite,
  updateEmployee,
  deleteEmployee,
} from '../controllers/org.controller.js';
import {
  getHierarchy,
  moveHierarchyNode,
  getMobilityHistory,
} from '../controllers/hierarchy.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';
import { requirePermission } from '../middlewares/role.js';

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
router.delete('/employees/:id', deleteEmployee);
router.post('/employees/:id/resend-invite', resendInvite);

/**
 * /api/org/hierarchy
 */
router.get('/hierarchy', requirePermission('view_hierarchy'), getHierarchy);
router.patch('/hierarchy/move', requirePermission('manage_hierarchy'), moveHierarchyNode);
router.get('/hierarchy/mobility/:employeeId', requirePermission('view_hierarchy'), getMobilityHistory);

export default router;

