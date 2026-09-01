import { Router } from 'express';
import {
  getMyPayrollHistory,
  getPayrollRecords,
  getPayrollRecordById,
  generatePayroll,
  updatePayrollStatus,
  getMyPayslips,
  getPersonPayslips,
  uploadPayslip,
} from '../controllers/payroll.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';
import { requireRole } from '../middlewares/requireRole.js';

const router = Router();

router.use(requireAuth);
router.use(requireTenant);

// Self-view routes (Must be placed before parameterized /:id routes)
router.get('/me', getMyPayrollHistory);
router.get('/payslips/me', getMyPayslips);

// Payroll records management
router.get('/records', requireRole('Org Admin', 'HR Manager', 'CEO'), getPayrollRecords);
router.get('/records/:id', requireRole('Org Admin', 'HR Manager', 'CEO'), getPayrollRecordById);
router.post('/generate', requireRole('Org Admin', 'HR Manager'), generatePayroll);
router.patch('/records/:id/status', requireRole('Org Admin', 'HR Manager'), updatePayrollStatus);

// Payslips administration
router.get('/payslips/person/:id', requireRole('Org Admin', 'HR Manager', 'CEO'), getPersonPayslips);
router.post('/payslips', requireRole('Org Admin', 'HR Manager'), uploadPayslip);

export default router;
