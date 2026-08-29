import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentSubscription, getSubscriptionPlans, changeSubscriptionPlan } from '../src/controllers/subscriptions.controller.js';

vi.mock('../src/db/index.js', () => ({
  db: {
    query: vi.fn(),
  },
}));

import { db } from '../src/db/index.js';

describe('Subscriptions & Finance Summary Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCurrentSubscription', () => {
    it('returns current subscription details and features', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            subscription_id: 'sub-1',
            organization_id: 'org-123',
            status: 'active',
            current_period_start: '2026-08-01T00:00:00Z',
            current_period_end: '2027-08-01T00:00:00Z',
            cancel_at_period_end: false,
            plan_id: 'plan-1',
            plan_name: 'Growth',
            plan_slug: 'growth',
            max_employees: 100,
            price_cents: 0,
            currency: 'USD',
            plan_metadata: { features: ['basic_attendance', 'billing_portal'] },
          },
        ],
      });

      const req = { user: { organization_id: 'org-123' } };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await getCurrentSubscription(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        data: expect.objectContaining({
          organization_id: 'org-123',
          status: 'active',
          features: ['basic_attendance', 'billing_portal'],
        }),
      });
    });
  });

  describe('getSubscriptionPlans', () => {
    it('returns list of active subscription plans', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'p1',
            name: 'Starter',
            slug: 'starter',
            max_employees: 50,
            price_cents: 0,
            currency: 'USD',
            metadata: { features: ['basic_attendance'] },
          },
          {
            id: 'p2',
            name: 'Growth',
            slug: 'growth',
            max_employees: 100,
            price_cents: 0,
            currency: 'USD',
            metadata: { features: ['basic_attendance', 'billing_portal'] },
          },
        ],
      });

      const req = {};
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await getSubscriptionPlans(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        data: {
          plans: [
            {
              id: 'p1',
              name: 'Starter',
              slug: 'starter',
              max_employees: 50,
              price_cents: 0,
              currency: 'USD',
              features: ['basic_attendance'],
            },
            {
              id: 'p2',
              name: 'Growth',
              slug: 'growth',
              max_employees: 100,
              price_cents: 0,
              currency: 'USD',
              features: ['basic_attendance', 'billing_portal'],
            },
          ],
        },
      });
    });
  });

  describe('changeSubscriptionPlan', () => {
    it('successfully updates subscription plan and creates audit entry', async () => {
      db.query
        // 1. Target plan lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'p2',
              name: 'Growth',
              slug: 'growth',
              max_employees: 100,
              price_cents: 0,
              currency: 'USD',
              metadata: { features: ['billing_portal'] },
            },
          ],
        })
        // 2. Active employee headcount lookup
        .mockResolvedValueOnce({
          rows: [{ count: 10 }],
        })
        // 3. Old plan lookup
        .mockResolvedValueOnce({
          rows: [{ plan_id: 'p1' }],
        })
        // 4. Upsert subscription query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'sub-99',
              status: 'active',
              current_period_start: '2026-08-01T00:00:00Z',
              current_period_end: '2027-08-01T00:00:00Z',
            },
          ],
        })
        // 5. Subscription changes insert
        .mockResolvedValueOnce({ rows: [] })
        // 6. Audit log insert
        .mockResolvedValueOnce({ rows: [] });

      const req = {
        body: { plan_id: 'p2' },
        user: { organization_id: 'org-123', person_id: 'admin-1' },
      };
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();

      await changeSubscriptionPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          message: 'Subscription plan successfully changed to Growth',
        })
      );
    });
  });
});
