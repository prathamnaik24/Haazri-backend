import { Router } from 'express';
import {
  getAllRecords,
  getMyRecords,
  getPersonRecords,
  createRecord,
  updateRecord,
  getFinanceSummary,
  getFinancialSnapshots,
  generateFinancialSnapshot,
} from '../controllers/finance.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';
import { requireRole } from '../middlewares/requireRole.js';
import { requireFeature } from '../middlewares/feature.js';

const router = Router();
router.use(requireAuth);
router.use(requireTenant);

// Summary route for CEO / Org Admin
router.get('/summary',
  requireRole('Org Admin', 'CEO'),
  requireFeature('financial_dashboard'),
  getFinanceSummary
);

// Snapshots timeline route
router.get('/snapshots',
  requireRole('Org Admin', 'CEO'),
  requireFeature('financial_dashboard'),
  getFinancialSnapshots
);

// Manual snapshot generation route
router.post('/snapshots/generate',
  requireRole('Org Admin', 'CEO'),
  requireFeature('financial_dashboard'),
  generateFinancialSnapshot
);

// Self-view — must be BEFORE /records/:id to avoid :id matching "me"
router.get('/records/me', getMyRecords);

// Full-access routes — CEO / Org Admin
router.get('/records',
  requireRole('Org Admin', 'CEO'),
  getAllRecords
);
router.post('/records',
  requireRole('Org Admin'),
  createRecord
);
router.get('/records/person/:id',
  requireRole('Org Admin', 'CEO'),
  getPersonRecords
);
router.patch('/records/:id',
  requireRole('Org Admin'),
  updateRecord
);

export default router;
