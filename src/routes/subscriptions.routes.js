import { Router } from 'express';
import {
  getCurrentSubscription,
  getSubscriptionPlans,
  changeSubscriptionPlan,
  getSubscriptionHistory,
} from '../controllers/subscriptions.controller.js';
import { requireAuth } from '../middlewares/auth.js';
import { requireTenant } from '../middlewares/tenant.js';
import { requireFeature } from '../middlewares/feature.js';

const router = Router();

router.use(requireAuth);
router.use(requireTenant);

// GET /api/subscriptions/current
router.get('/current', requireFeature('billing_portal'), getCurrentSubscription);

// GET /api/subscriptions/plans
router.get('/plans', requireFeature('billing_portal'), getSubscriptionPlans);

// GET /api/subscriptions/history
router.get('/history', requireFeature('billing_portal'), getSubscriptionHistory);

// POST /api/subscriptions/change-plan
router.post('/change-plan', requireFeature('subscription_management'), changeSubscriptionPlan);

export default router;
