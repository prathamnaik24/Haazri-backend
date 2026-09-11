import { Router } from 'express';
import {
  getMyPayrollHistory,
  getPayrollRecords,
  getPayrollRecordById,
  generatePayroll,
  updatePayrollStatus,
  getMyPayslips,
  getPersonPayslips,
  getPayslipDetail,
  downloadPayslipPdf,
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

// Payslip retrieval & PDF download (Service handles IDOR verification: employee can access own, Admin/HR can access any)
router.get('/payslips/person/:id', requireRole('Org Admin', 'HR Manager', 'CEO'), getPersonPayslips);
router.get('/payslips/:id/pdf', downloadPayslipPdf);
router.get('/payslips/:id', getPayslipDetail);

// Payroll records management
router.get('/records', requireRole('Org Admin', 'HR Manager', 'CEO'), getPayrollRecords);
router.get('/records/:id', requireRole('Org Admin', 'HR Manager', 'CEO'), getPayrollRecordById);
router.post('/generate', requireRole('Org Admin'), generatePayroll);
router.patch('/records/:id/status', requireRole('Org Admin'), updatePayrollStatus);

// Payslips administration
router.post('/payslips', requireRole('Org Admin'), uploadPayslip);

export default router;
