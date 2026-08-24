import { OrgService } from '../services/org.service.js';
import { AppError } from '../middlewares/errorHandler.js';

const orgService = new OrgService();

/**
 * POST /api/org/employees
 * Scoped to Org Admins / HR Managers.
 */
export const createEmployee = async (req, res, next) => {
  try {
    const tenantId = req.currentTenantId;
    const invitedBy = req.user.person_id;

    // Optional Role check: ensure requester is Org Admin or HR Manager
    const roles = req.user.roles || [];
    const isAuthorized = roles.includes('Org Admin') || roles.includes('HR Manager');
    if (!isAuthorized) {
      throw new AppError('Forbidden: Insufficient privileges to invite employees', 403);
    }

    const result = await orgService.createEmployee(tenantId, req.body, invitedBy);

    res.status(201).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/org/employees/:id
 * Scoped to Org Admins / HR Managers.
 */
export const updateEmployee = async (req, res, next) => {
  try {
    const tenantId = req.currentTenantId;
    const employeeId = req.params.id;
    const changedBy = req.user.person_id;

    const roles = req.user.roles || [];
    const isAuthorized = roles.includes('Org Admin') || roles.includes('HR Manager');
    if (!isAuthorized) {
      throw new AppError('Forbidden: Insufficient privileges to update employees', 403);
    }

    const result = await orgService.updateEmployee(tenantId, employeeId, req.body, changedBy);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/org/employees/:id/resend-invite
 */
export const resendInvite = async (req, res, next) => {
  try {
    const tenantId = req.currentTenantId;
    const employeeId = req.params.id;
    const invitedBy = req.user.person_id;

    const roles = req.user.roles || [];
    const isAuthorized = roles.includes('Org Admin') || roles.includes('HR Manager');
    if (!isAuthorized) {
      throw new AppError('Forbidden: Insufficient privileges to resend invites', 403);
    }

    const result = await orgService.resendInvite(tenantId, employeeId, invitedBy);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/org/employees
 */
export const listEmployees = async (req, res, next) => {
  try {
    const tenantId = req.currentTenantId;
    const limit = parseInt(req.query.limit || '20', 10);
    const offset = parseInt(req.query.offset || '0', 10);

    const result = await orgService.listEmployees(tenantId, { limit, offset });

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/org/employees/:id
 */
export const getEmployeeById = async (req, res, next) => {
  try {
    const tenantId = req.currentTenantId;
    const employeeId = req.params.id;

    const result = await orgService.getEmployeeById(tenantId, employeeId);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
