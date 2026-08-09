import { Router } from 'express';
import {
  registerOrg,
  loginOrg,
  loginEmployee,
  getMe,
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
 */
router.post('/employee/login', loginEmployee);

/**
 * Common — get authenticated user context from token
 * GET /api/auth/me              — Returns JWT payload (protected)
 */
router.get('/me', requireAuth, getMe);

export default router;
