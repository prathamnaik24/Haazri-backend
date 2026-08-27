import { LeaveService } from '../services/leave.service.js';
import { AppError } from '../middlewares/errorHandler.js';

const leaveService = new LeaveService();

/** POST /api/leaves/request */
export const requestLeave = async (req, res, next) => {
  try {
    const result = await leaveService.requestLeave(req.user.person_id, req.currentTenantId, req.body);
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/leaves/me?year= */
export const getMyLeaves = async (req, res, next) => {
  try {
    const year = parseInt(req.query.year || new Date().getFullYear().toString(), 10);
    const result = await leaveService.getMyLeaves(req.user.person_id, year);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** DELETE /api/leaves/request/:id — Cancel own pending leave */
export const cancelMyLeave = async (req, res, next) => {
  try {
    const result = await leaveService.cancelMyLeave(req.user.person_id, req.params.id);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/leaves/team/pending */
export const getTeamPendingLeaves = async (req, res, next) => {
  try {
    const managerPositionPath = req.user.position_path;
    if (!managerPositionPath) {
      throw new AppError('Access denied: You are not assigned to a management position', 403);
    }
    const result = await leaveService.getTeamPendingLeaves(
      managerPositionPath, req.currentTenantId, req.user.person_id
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** PATCH /api/leaves/request/:id/action */
export const actionLeaveRequest = async (req, res, next) => {
  try {
    const { action, remark } = req.body;
    const result = await leaveService.actionLeaveRequest(
      req.params.id, req.user.person_id, req.currentTenantId, action, remark
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/leaves/hr?status=&from=&to=&leave_type_id=&person_name= */
export const getHRLeaves = async (req, res, next) => {
  try {
    const result = await leaveService.getHRLeaves(req.currentTenantId, {
      status:        req.query.status,
      from:          req.query.from,
      to:            req.query.to,
      leave_type_id: req.query.leave_type_id,
      person_name:   req.query.person_name,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/leaves/types */
export const getLeaveTypes = async (req, res, next) => {
  try {
    const result = await leaveService.getLeaveTypes(req.currentTenantId);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};
