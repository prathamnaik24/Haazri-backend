import { Router } from 'express';
import {
  getTemplates,
  applyTemplate,
  getDepartments,
  getPositionsTree,
  createPosition,
  updatePosition,
  deletePosition,
} from '../controllers/admin/orgStructure.controller.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/templates', getTemplates);
router.post('/templates/apply', applyTemplate);
router.get('/departments', getDepartments);
router.get('/positions', getPositionsTree);
router.post('/positions', createPosition);
router.patch('/positions/:id', updatePosition);
router.delete('/positions/:id', deletePosition);

export default router;
