import { db } from '../db/index.js';

export class FinanceSnapshotsService {
  /**
   * Create or update a financial snapshot for an organization for a specific date.
   */
  async createFinancialSnapshot({ organizationId, date }) {
    const snapshotDate = date || new Date().toISOString().split('T')[0];

    // 1. Fetch active subscription plan price
    const subRes = await db.query(
      `SELECT sp.price_cents, sp.name as plan_name
       FROM organization_subscriptions os
       JOIN subscription_plans sp ON sp.id = os.plan_id
       WHERE os.organization_id = $1`,
      [organizationId]
    );

    const planPriceCents = subRes.rows[0]?.price_cents || 0;
    const planName = subRes.rows[0]?.plan_name || 'Starter';

    // 2. Compute total financial records expenditure
    const recRes = await db.query(
      `SELECT COALESCE(SUM(amount), 0)::float as total FROM financial_records WHERE organization_id = $1`,
      [organizationId]
    );
    const recordsTotalAmount = recRes.rows[0]?.total || 0;
    const totalExpenditureCents = Math.round(recordsTotalAmount * 100) + planPriceCents;

    // 3. Count total active employees
    const empRes = await db.query(
      `SELECT COUNT(*)::int as count FROM persons WHERE organization_id = $1 AND is_active = true`,
      [organizationId]
    );
    const totalEmployees = empRes.rows[0]?.count || 0;

    // 4. Compute department headcount breakdown
    const deptRes = await db.query(
      `SELECT d.id as department_id, d.name,
              COUNT(DISTINCT pa.person_id)::int as headcount
       FROM departments d
       LEFT JOIN positions pos ON pos.department_id = d.id AND pos.is_active = true
       LEFT JOIN position_assignments pa ON pa.position_id = pos.id AND pa.end_date IS NULL
       WHERE d.organization_id = $1 AND d.is_active = true
       GROUP BY d.id, d.name
       ORDER BY d.name ASC`,
      [organizationId]
    );

    const deptHeadcounts = {};
    const deptNames = {};
    let sumHeads = 0;

    deptRes.rows.forEach((dept) => {
      const hc = dept.headcount || 0;
      deptHeadcounts[dept.department_id] = hc;
      deptNames[dept.department_id] = dept.name;
      sumHeads += hc;
    });

    const departmentBreakdown = {};
    const deptCount = deptRes.rows.length;

    deptRes.rows.forEach((dept) => {
      const deptId = dept.department_id;
      const hc = dept.headcount || 0;
      let share = 0;

      if (sumHeads > 0) {
        share = Math.round((hc / sumHeads) * totalExpenditureCents);
      } else if (deptCount > 0) {
        share = Math.round(totalExpenditureCents / deptCount);
      }

      departmentBreakdown[deptId] = {
        name: dept.name,
        headcount: hc,
        expenditure_cents: share,
      };
    });

    const metadata = {
      plan_name: planName,
      plan_price_cents: planPriceCents,
      records_total_cents: Math.round(recordsTotalAmount * 100),
      employee_count: totalEmployees,
      generated_at: new Date().toISOString(),
    };

    // 5. Upsert financial snapshot
    const result = await db.query(
      `INSERT INTO financial_snapshots
         (organization_id, snapshot_date, total_expenditure_cents, department_breakdown, metadata)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (organization_id, snapshot_date) DO UPDATE
       SET total_expenditure_cents = EXCLUDED.total_expenditure_cents,
           department_breakdown = EXCLUDED.department_breakdown,
           metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        organizationId,
        snapshotDate,
        totalExpenditureCents,
        JSON.stringify(departmentBreakdown),
        JSON.stringify(metadata),
      ]
    );

    return result.rows[0];
  }

  /**
   * Get historical financial snapshots for an organization.
   */
  async getFinancialSnapshots(organizationId, filters = {}) {
    const { from, to, department_id } = filters;
    const params = [organizationId];
    const conditions = ['organization_id = $1'];

    if (from) {
      params.push(from);
      conditions.push(`snapshot_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`snapshot_date <= $${params.length}`);
    }

    const result = await db.query(
      `SELECT * FROM financial_snapshots
       WHERE ${conditions.join(' AND ')}
       ORDER BY snapshot_date ASC`,
      params
    );

    let snapshots = result.rows;

    if (department_id) {
      snapshots = snapshots.map((snap) => {
        const bd = snap.department_breakdown || {};
        const deptInfo = bd[department_id];
        return {
          ...snap,
          department_breakdown: deptInfo ? { [department_id]: deptInfo } : {},
        };
      });
    }

    return snapshots;
  }

  /**
   * Get the most recent financial snapshot for an organization.
   */
  async getLatestSnapshot(organizationId) {
    const result = await db.query(
      `SELECT * FROM financial_snapshots
       WHERE organization_id = $1
       ORDER BY snapshot_date DESC
       LIMIT 1`,
      [organizationId]
    );

    return result.rows[0] || null;
  }
}
