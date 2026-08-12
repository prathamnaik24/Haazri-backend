import { LeaveService } from '../services/leave.service.js';
import { AppError } from '../middlewares/errorHandler.js';

const leaveService = new LeaveService();

/**
 * POST /api/leaves/request
 */
export const requestLeave = async (req, res, next) => {
  try {
    const personId = req.user.person_id;
    const tenantId = req.currentTenantId;

    const result = await leaveService.requestLeave(personId, tenantId, req.body);

    res.status(201).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/leaves/me
 */
export const getMyLeaves = async (req, res, next) => {
  try {
    const personId = req.user.person_id;
    const year = parseInt(req.query.year || new Date().getFullYear().toString(), 10);

    const result = await leaveService.getMyLeaves(personId, year);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/leaves/team/pending
 */
export const getTeamPendingLeaves = async (req, res, next) => {
  try {
    const tenantId = req.currentTenantId;
    const managerPositionPath = req.user.position_path;

    if (!managerPositionPath) {
      throw new AppError('Access denied: You are not assigned to a position in the management hierarchy', 403);
    }

    const result = await leaveService.getTeamPendingLeaves(managerPositionPath, tenantId, req.user.person_id);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/leaves/request/:id/action
 */
export const actionLeaveRequest = async (req, res, next) => {
  try {
    const managerId = req.user.person_id;
    const tenantId = req.currentTenantId;
    const requestId = req.params.id;
    const { action } = req.body;

    const result = await leaveService.actionLeaveRequest(requestId, managerId, tenantId, action);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
