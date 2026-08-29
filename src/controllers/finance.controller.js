import { FinanceService } from '../services/finance.service.js';
import { FinanceSnapshotsService } from '../services/financeSnapshots.service.js';

const financeService = new FinanceService();
const snapshotsService = new FinanceSnapshotsService();

/** GET /api/finance/records  — CEO / Org Admin full view */
export const getAllRecords = async (req, res, next) => {
  try {
    const result = await financeService.getAllRecords(req.currentTenantId, {
      person_id:    req.query.person_id,
      record_type:  req.query.record_type,
      period_year:  req.query.period_year,
      period_month: req.query.period_month,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/finance/records/me  — Any authenticated employee */
export const getMyRecords = async (req, res, next) => {
  try {
    const result = await financeService.getMyRecords(req.currentTenantId, req.user.person_id, {
      record_type: req.query.record_type,
      period_year: req.query.period_year,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/finance/records/person/:id  — CEO / Org Admin */
export const getPersonRecords = async (req, res, next) => {
  try {
    const result = await financeService.getPersonRecords(req.currentTenantId, req.params.id);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** POST /api/finance/records  — Org Admin only */
export const createRecord = async (req, res, next) => {
  try {
    const result = await financeService.createRecord(
      req.currentTenantId, req.user.person_id, req.body
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** PATCH /api/finance/records/:id  — Org Admin only */
export const updateRecord = async (req, res, next) => {
  try {
    const result = await financeService.updateRecord(
      req.currentTenantId, req.params.id, req.user.person_id, req.body
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/finance/summary  — CEO / Org Admin financial summary */
export const getFinanceSummary = async (req, res, next) => {
  try {
    const result = await financeService.getSummary(req.currentTenantId);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/finance/snapshots  — CEO / Org Admin financial snapshot timeline */
export const getFinancialSnapshots = async (req, res, next) => {
  try {
    const snapshots = await snapshotsService.getFinancialSnapshots(req.currentTenantId, {
      from: req.query.from,
      to: req.query.to,
      department_id: req.query.department_id,
    });
    res.status(200).json({ status: 'success', data: { snapshots } });
  } catch (err) { next(err); }
};

/** POST /api/finance/snapshots/generate  — Generate today's snapshot */
export const generateFinancialSnapshot = async (req, res, next) => {
  try {
    const snapshot = await snapshotsService.createFinancialSnapshot({
      organizationId: req.currentTenantId,
      date: req.body.date,
    });
    res.status(201).json({
      status: 'success',
      message: `Financial snapshot generated for ${snapshot.snapshot_date}`,
      data: { snapshot },
    });
  } catch (err) { next(err); }
};
