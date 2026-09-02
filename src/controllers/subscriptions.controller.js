import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

/**
 * GET /api/subscriptions/current
 * Returns the organization's current active subscription, plan details, and features.
 */
export const getCurrentSubscription = async (req, res, next) => {
  try {
    const orgId = req.user.organization_id;

    let subRes = await db.query(
      `SELECT os.id as subscription_id, os.organization_id, os.status,
              os.current_period_start, os.current_period_end, os.cancel_at_period_end,
              sp.id as plan_id, sp.name as plan_name, sp.slug as plan_slug,
              sp.max_employees, sp.price_cents, sp.currency, sp.metadata as plan_metadata
       FROM organization_subscriptions os
       JOIN subscription_plans sp ON sp.id = os.plan_id
       WHERE os.organization_id = $1`,
      [orgId]
    );

    // Fallback: if no subscription exists yet for org, attach Growth plan automatically
    if (subRes.rows.length === 0) {
      const growthRes = await db.query(`SELECT id FROM subscription_plans WHERE slug = 'growth' LIMIT 1`);
      if (growthRes.rows.length > 0) {
        const planId = growthRes.rows[0].id;
        await db.query(
          `INSERT INTO organization_subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
           VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '1 year')
           ON CONFLICT (organization_id) DO NOTHING`,
          [orgId, planId]
        );

        subRes = await db.query(
          `SELECT os.id as subscription_id, os.organization_id, os.status,
                  os.current_period_start, os.current_period_end, os.cancel_at_period_end,
                  sp.id as plan_id, sp.name as plan_name, sp.slug as plan_slug,
                  sp.max_employees, sp.price_cents, sp.currency, sp.metadata as plan_metadata
           FROM organization_subscriptions os
           JOIN subscription_plans sp ON sp.id = os.plan_id
           WHERE os.organization_id = $1`,
          [orgId]
        );
      }
    }

    if (subRes.rows.length === 0) {
      throw new AppError('No subscription found for this organization', 404);
    }

    const row = subRes.rows[0];
    const features = row.plan_metadata?.features || [];

    res.status(200).json({
      status: 'success',
      data: {
        organization_id: row.organization_id,
        plan: {
          id: row.plan_id,
          name: row.plan_name,
          slug: row.plan_slug,
          max_employees: row.max_employees,
          price_cents: row.price_cents,
          currency: row.currency,
        },
        status: row.status,
        current_period: {
          start: row.current_period_start,
          end: row.current_period_end,
        },
        cancel_at_period_end: row.cancel_at_period_end,
        features,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/subscriptions/plans
 * Returns all active subscription plans.
 */
export const getSubscriptionPlans = async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, slug, max_employees, price_cents, currency, metadata
       FROM subscription_plans
       WHERE is_active = true
       ORDER BY price_cents ASC, max_employees ASC`
    );

    const plans = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      max_employees: row.max_employees,
      price_cents: row.price_cents,
      currency: row.currency,
      features: row.metadata?.features || [],
    }));

    res.status(200).json({
      status: 'success',
      data: { plans },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/subscriptions/change-plan
 * Body: { plan_id } or { plan_slug }
 * Validates employee headcount and updates subscription.
 */
export const changeSubscriptionPlan = async (req, res, next) => {
  try {
    const { plan_id, plan_slug } = req.body;
    const orgId = req.user.organization_id;

    if (!plan_id && !plan_slug) {
      throw new AppError('plan_id or plan_slug is required', 400);
    }

    let planRes;
    if (plan_id) {
      planRes = await db.query(
        `SELECT id, name, slug, max_employees, price_cents, currency, metadata FROM subscription_plans WHERE id = $1 AND is_active = true`,
        [plan_id]
      );
    } else {
      planRes = await db.query(
        `SELECT id, name, slug, max_employees, price_cents, currency, metadata FROM subscription_plans WHERE slug = $1 AND is_active = true`,
        [plan_slug]
      );
    }

    if (planRes.rows.length === 0) {
      throw new AppError('Specified subscription plan was not found or is inactive', 404);
    }

    const newPlan = planRes.rows[0];

    // 1. Fetch current active employee headcount
    const empRes = await db.query(
      `SELECT COUNT(*)::int as count FROM persons WHERE organization_id = $1 AND is_active = true`,
      [orgId]
    );
    const activeEmployeeCount = empRes.rows[0]?.count || 0;

    // 2. Validate employee capacity
    if (activeEmployeeCount > newPlan.max_employees) {
      return res.status(400).json({
        status: 'error',
        error: 'PLAN_CHANGE_EXCEEDS_MAX_EMPLOYEES',
        message: `Your organization currently has ${activeEmployeeCount} active employees. The selected ${newPlan.name} plan supports up to ${newPlan.max_employees} employees.`,
        current_employee_count: activeEmployeeCount,
        plan_max_employees: newPlan.max_employees,
      });
    }

    // 3. Fetch old subscription plan ID for history
    const oldSubRes = await db.query(
      `SELECT plan_id FROM organization_subscriptions WHERE organization_id = $1`,
      [orgId]
    );
    const oldPlanId = oldSubRes.rows[0]?.plan_id || null;

    // 4. Upsert organization subscription
    const subRes = await db.query(
      `INSERT INTO organization_subscriptions (organization_id, plan_id, status, current_period_start, current_period_end, updated_at)
       VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '1 year', NOW())
       ON CONFLICT (organization_id) DO UPDATE
       SET plan_id = EXCLUDED.plan_id,
           status = 'active',
           updated_at = NOW()
       RETURNING id, current_period_start, current_period_end, status`,
      [orgId, newPlan.id]
    );

    const updatedSub = subRes.rows[0];

    // 5. Insert subscription change history
    if (req.user?.person_id) {
      await db.query(
        `INSERT INTO organization_subscription_changes
           (organization_id, changed_by_user_id, old_plan_id, new_plan_id, reason, metadata)
         VALUES ($1, $2, $3, $4, 'Self-service plan update', $5::jsonb)`,
        [
          orgId,
          req.user.person_id,
          oldPlanId,
          newPlan.id,
          JSON.stringify({ active_employees: activeEmployeeCount }),
        ]
      );
    }

    // 6. Log audit event
    await db.query(
      `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, new_data, changed_by, reason)
       VALUES ($1, 'organization_subscription', $2, 'UPDATE', $3::jsonb, $4, 'Subscription plan changed by admin')`,
      [
        orgId,
        updatedSub.id,
        JSON.stringify({ plan_id: newPlan.id, plan_slug: newPlan.slug, plan_name: newPlan.name }),
        req.user.person_id,
      ]
    );

    res.status(200).json({
      status: 'success',
      message: `Subscription plan successfully changed to ${newPlan.name}`,
      data: {
        organization_id: orgId,
        plan: {
          id: newPlan.id,
          name: newPlan.name,
          slug: newPlan.slug,
          max_employees: newPlan.max_employees,
          price_cents: newPlan.price_cents,
          currency: newPlan.currency,
        },
        status: updatedSub.status,
        current_period: {
          start: updatedSub.current_period_start,
          end: updatedSub.current_period_end,
        },
        features: newPlan.metadata?.features || [],
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/subscriptions/history
 * Returns the timeline of subscription plan changes for the organization.
 */
export const getSubscriptionHistory = async (req, res, next) => {
  try {
    const orgId = req.user.organization_id;

    const result = await db.query(
      `SELECT sc.id, sc.changed_at, sc.reason, sc.metadata,
              p.first_name, p.last_name, p.email,
              old_p.name as old_plan_name, old_p.slug as old_plan_slug,
              new_p.name as new_plan_name, new_p.slug as new_plan_slug
       FROM organization_subscription_changes sc
       JOIN persons p ON p.id = sc.changed_by_user_id
       LEFT JOIN subscription_plans old_p ON old_p.id = sc.old_plan_id
       JOIN subscription_plans new_p ON new_p.id = sc.new_plan_id
       WHERE sc.organization_id = $1
       ORDER BY sc.changed_at DESC`,
      [orgId]
    );

    const history = result.rows.map((row) => ({
      id: row.id,
      changed_at: row.changed_at,
      changed_by: {
        name: `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Admin',
        email: row.email,
      },
      old_plan: row.old_plan_name ? { name: row.old_plan_name, slug: row.old_plan_slug } : null,
      new_plan: { name: row.new_plan_name, slug: row.new_plan_slug },
      reason: row.reason,
      metadata: row.metadata || {},
    }));

    res.status(200).json({
      status: 'success',
      data: { history },
    });
  } catch (err) {
    next(err);
  }
};
