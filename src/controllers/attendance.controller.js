import { AttendanceService } from '../services/attendance.service.js';
import { AppError } from '../middlewares/errorHandler.js';

const attendanceService = new AttendanceService();

/**
 * POST /api/attendance/check-in
 */
export const checkIn = async (req, res, next) => {
  try {
    const personId = req.user.person_id;
    const tenantId = req.currentTenantId;
    const { metadata = {} } = req.body;

    const result = await attendanceService.checkIn(personId, tenantId, metadata);

    res.status(201).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/attendance/check-out
 */
export const checkOut = async (req, res, next) => {
  try {
    const personId = req.user.person_id;
    const tenantId = req.currentTenantId;

    const result = await attendanceService.checkOut(personId, tenantId);

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/attendance/me
 */
export const getMyHistory = async (req, res, next) => {
  try {
    const personId = req.user.person_id;
    const limit = parseInt(req.query.limit || '30', 10);
    const offset = parseInt(req.query.offset || '0', 10);

    const result = await attendanceService.getMyHistory(personId, { limit, offset });

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/attendance/team
 * Accessible only to managers (requires position_path in JWT token)
 */
export const getTeamHistory = async (req, res, next) => {
  try {
    const tenantId = req.currentTenantId;
    const managerPositionPath = req.user.position_path;
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = parseInt(req.query.offset || '0', 10);

    if (!managerPositionPath) {
      throw new AppError('Access denied: You are not assigned to a position in the management hierarchy', 403);
    }

    const result = await attendanceService.getTeamHistory(managerPositionPath, tenantId, { limit, offset });

    res.status(200).json({
      status: 'success',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};
