import { Router } from 'express';
import {
  registerOrg,
  loginOrg,
  loginEmployee,
  getMe,
  updateProfile,
  changePassword,
  acceptInvite,
} from '../controllers/auth.controller.js';
import { requireAuth } from '../middlewares/auth.js';

const router = Router();

/**
 * Organization Auth
 * POST /api/auth/org/register   — Create a new org + its first admin
 * POST /api/auth/org/login      — Org admin login
 */
router.post('/org/register', registerOrg);
router.post('/org/login', loginOrg);

/**
 * Employee Auth
 * POST /api/auth/employee/login — Employee login (requires org_slug)
 * POST /api/auth/invite/accept   — Employee sets password via invite token
 */
router.post('/employee/login', loginEmployee);
router.post('/invite/accept', acceptInvite);

/**
 * User Profile & Account Settings (Protected)
 * GET   /api/auth/me              — Returns user profile and token context
 * PATCH /api/auth/profile         — Updates profile details (name, phone)
 * POST  /api/auth/change-password — Changes user password
 */
router.get('/me', requireAuth, getMe);
router.patch('/profile', requireAuth, updateProfile);
router.post('/change-password', requireAuth, changePassword);

export default router;
