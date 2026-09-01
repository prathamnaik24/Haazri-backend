import { CompensationPayrollService } from '../services/compensationPayroll.service.js';

const service = new CompensationPayrollService();

/** GET /api/compensation/me — Employee self-view */
export const getMyCompensation = async (req, res, next) => {
  try {
    const result = await service.getEmployeeCompensation(req.currentTenantId, req.user.person_id);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/compensation/person/:id — Admin/HR view */
export const getEmployeeCompensation = async (req, res, next) => {
  try {
    const result = await service.getEmployeeCompensation(req.currentTenantId, req.params.id);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** POST /api/compensation/person/:id/structure — Update base salary structure */
export const upsertSalaryStructure = async (req, res, next) => {
  try {
    const result = await service.upsertSalaryStructure(req.currentTenantId, req.params.id, req.body);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/compensation/person/:id/components — Get salary components */
export const getComponents = async (req, res, next) => {
  try {
    const result = await service.getSalaryComponents(req.currentTenantId, req.params.id);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** POST /api/compensation/person/:id/components — Add salary component */
export const addComponent = async (req, res, next) => {
  try {
    const result = await service.addSalaryComponent(
      req.currentTenantId,
      req.params.id,
      req.user.person_id,
      req.body
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** PATCH /api/compensation/components/:id — Update component */
export const updateComponent = async (req, res, next) => {
  try {
    const result = await service.updateSalaryComponent(
      req.currentTenantId,
      req.params.id,
      req.user.person_id,
      req.body
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** DELETE /api/compensation/components/:id — Deactivate component */
export const deleteComponent = async (req, res, next) => {
  try {
    const result = await service.deleteSalaryComponent(req.currentTenantId, req.params.id);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/compensation/increments — List increments (Admin/HR) */
export const getIncrements = async (req, res, next) => {
  try {
    const result = await service.getIncrements(req.currentTenantId, {
      person_id: req.query.person_id,
      status: req.query.status,
      proposed_by: req.query.proposed_by,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/compensation/increments/me — Employee self-view increments */
export const getMyIncrements = async (req, res, next) => {
  try {
    const result = await service.getIncrements(req.currentTenantId, {
      person_id: req.user.person_id,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** POST /api/compensation/increments — Propose salary increment */
export const proposeIncrement = async (req, res, next) => {
  try {
    const result = await service.proposeIncrement(
      req.currentTenantId,
      req.user.person_id,
      req.body
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** PATCH /api/compensation/increments/:id/status — Review increment status */
export const reviewIncrement = async (req, res, next) => {
  try {
    const result = await service.reviewIncrement(
      req.currentTenantId,
      req.params.id,
      req.user.person_id,
      req.body
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};
