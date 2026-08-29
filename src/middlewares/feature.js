import { db } from '../db/index.js';
import { AppError } from './errorHandler.js';

/**
 * Middleware factory to enforce feature flags based on the organization's active subscription plan.
 *
 * @param {string} requiredFeature - The feature flag required to access this endpoint (e.g., 'financial_dashboard')
 */
export const requireFeature = (requiredFeature) => async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.currentTenantId;

    if (!orgId) {
      throw new AppError('Tenant organization ID required for feature check', 400);
    }

    const result = await db.query(
      `SELECT sp.metadata
       FROM organization_subscriptions os
       JOIN subscription_plans sp ON sp.id = os.plan_id
       WHERE os.organization_id = $1`,
      [orgId]
    );

    let allowedFeatures = [];

    if (result.rows.length > 0 && result.rows[0].metadata?.features) {
      allowedFeatures = result.rows[0].metadata.features;
    } else {
      // Fallback: Growth plan features default
      allowedFeatures = [
        'basic_attendance',
        'basic_leaves',
        'financial_dashboard',
        'billing_portal',
        'subscription_management',
      ];
    }

    if (!allowedFeatures.includes(requiredFeature)) {
      return res.status(403).json({
        status: 'error',
        error: 'FEATURE_NOT_AVAILABLE',
        message: `The requested feature '${requiredFeature}' is not enabled in your current subscription plan tier.`,
        required_feature: requiredFeature,
      });
    }

    next();
  } catch (err) {
    next(err);
  }
};
