import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FinanceSnapshotsService } from '../src/services/financeSnapshots.service.js';
import { requireFeature } from '../src/middlewares/feature.js';
import { changeSubscriptionPlan, getSubscriptionHistory } from '../src/controllers/subscriptions.controller.js';

vi.mock('../src/db/index.js', () => ({
  db: {
    query: vi.fn(),
  },
}));

import { db } from '../src/db/index.js';

describe('Phase 2 — Financial Snapshots & Feature Enforcement', () => {
  let snapshotsService;

  beforeEach(() => {
    vi.clearAllMocks();
    snapshotsService = new FinanceSnapshotsService();
  });

  describe('FinanceSnapshotsService', () => {
    it('creates financial snapshot with department breakdown', async () => {
      // 1. Plan query
      db.query.mockResolvedValueOnce({
        rows: [{ price_cents: 0, plan_name: 'Growth' }],
      });
      // 2. Financial records query
      db.query.mockResolvedValueOnce({
        rows: [{ total: 500.0 }],
      });
      // 3. Employee count query
      db.query.mockResolvedValueOnce({
        rows: [{ count: 10 }],
      });
      // 4. Department headcount query
      db.query.mockResolvedValueOnce({
        rows: [
          { department_id: 'dept-1', name: 'Engineering', headcount: 6 },
          { department_id: 'dept-2', name: 'Sales', headcount: 4 },
        ],
      });
      // 5. Upsert query
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'snap-1',
            organization_id: 'org-1',
            snapshot_date: '2026-08-29',
            total_expenditure_cents: 50000,
            department_breakdown: {
              'dept-1': { name: 'Engineering', headcount: 6, expenditure_cents: 30000 },
              'dept-2': { name: 'Sales', headcount: 4, expenditure_cents: 20000 },
            },
          },
        ],
      });

      const result = await snapshotsService.createFinancialSnapshot({
        organizationId: 'org-1',
        date: '2026-08-29',
      });

      expect(result).toBeDefined();
      expect(result.total_expenditure_cents).toBe(50000);
      expect(result.department_breakdown['dept-1'].expenditure_cents).toBe(30000);
    });

    it('queries historical financial snapshots with filters', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          { id: 's1', snapshot_date: '2026-08-01', total_expenditure_cents: 10000 },
          { id: 's2', snapshot_date: '2026-08-15', total_expenditure_cents: 15000 },
        ],
      });

      const snapshots = await snapshotsService.getFinancialSnapshots('org-1', {
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(snapshots.length).toBe(2);
      expect(snapshots[0].total_expenditure_cents).toBe(10000);
    });
  });

  describe('requireFeature Middleware', () => {
    it('passes when feature is present in plan metadata', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ metadata: { features: ['financial_dashboard', 'billing_portal'] } }],
      });

      const req = { user: { organization_id: 'org-1' } };
      const res = {};
      const next = vi.fn();

      const middleware = requireFeature('financial_dashboard');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('returns 403 when feature is missing from plan metadata', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ metadata: { features: ['basic_attendance'] } }],
      });

      const req = { user: { organization_id: 'org-1' } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      const middleware = requireFeature('financial_dashboard');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'FEATURE_NOT_AVAILABLE',
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Employee Limit Enforcement on Plan Change', () => {
    it('rejects plan change when active employee headcount exceeds plan max_employees', async () => {
      // 1. Target plan query (Starter: max 50 employees)
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'p1', name: 'Starter', slug: 'starter', max_employees: 50, price_cents: 0 }],
      });
      // 2. Employee headcount query (73 active employees)
      db.query.mockResolvedValueOnce({
        rows: [{ count: 73 }],
      });

      const req = {
        body: { plan_id: 'p1' },
        user: { organization_id: 'org-1', person_id: 'user-1' },
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await changeSubscriptionPlan(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'PLAN_CHANGE_EXCEEDS_MAX_EMPLOYEES',
          current_employee_count: 73,
          plan_max_employees: 50,
        })
      );
    });
  });

  describe('getSubscriptionHistory', () => {
    it('returns formatted plan change history timeline', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'h1',
            changed_at: '2026-08-20T10:00:00Z',
            reason: 'Self-service plan update',
            metadata: {},
            first_name: 'John',
            last_name: 'Admin',
            email: 'admin@acme-corp.com',
            old_plan_name: 'Starter',
            old_plan_slug: 'starter',
            new_plan_name: 'Growth',
            new_plan_slug: 'growth',
          },
        ],
      });

      const req = { user: { organization_id: 'org-1' } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await getSubscriptionHistory(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        status: 'success',
        data: {
          history: [
            expect.objectContaining({
              old_plan: { name: 'Starter', slug: 'starter' },
              new_plan: { name: 'Growth', slug: 'growth' },
              changed_by: { name: 'John Admin', email: 'admin@acme-corp.com' },
            }),
          ],
        },
      });
    });
  });
});
