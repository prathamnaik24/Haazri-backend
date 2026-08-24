import { Router } from 'express';
import {
  getRoles,
  getPermissions,
  createRole,
  updateRole,
  deleteRole,
  assignPermissions,
} from '../controllers/admin/role.controller.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/', getRoles);
router.post('/', createRole);
router.patch('/:roleId', updateRole);
router.delete('/:roleId', deleteRole);
router.get('/permissions', getPermissions);
router.post('/:roleId/permissions', assignPermissions);

export default router;
