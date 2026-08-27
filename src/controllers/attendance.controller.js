import { AttendanceService } from '../services/attendance.service.js';
import { AppError } from '../middlewares/errorHandler.js';

const attendanceService = new AttendanceService();

/** POST /api/attendance/check-in */
export const checkIn = async (req, res, next) => {
  try {
    const result = await attendanceService.checkIn(
      req.user.person_id, req.currentTenantId, req.body.metadata || {}
    );
    res.status(201).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** POST /api/attendance/check-out */
export const checkOut = async (req, res, next) => {
  try {
    const result = await attendanceService.checkOut(req.user.person_id, req.currentTenantId);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/attendance/me?limit=&offset= */
export const getMyHistory = async (req, res, next) => {
  try {
    const limit  = parseInt(req.query.limit  || '30', 10);
    const offset = parseInt(req.query.offset || '0',  10);
    const result = await attendanceService.getMyHistory(req.user.person_id, { limit, offset });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/attendance/me/summary?from=&to= */
export const getMySummary = async (req, res, next) => {
  try {
    const result = await attendanceService.getMySummary(req.user.person_id, {
      from: req.query.from,
      to:   req.query.to,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/attendance/team?limit=&offset= */
export const getTeamHistory = async (req, res, next) => {
  try {
    const managerPositionPath = req.user.position_path;
    if (!managerPositionPath) {
      throw new AppError('Access denied: You are not assigned to a management position', 403);
    }
    const limit  = parseInt(req.query.limit  || '50', 10);
    const offset = parseInt(req.query.offset || '0',  10);
    const result = await attendanceService.getTeamHistory(
      managerPositionPath, req.currentTenantId, { limit, offset }
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/attendance/reports/daily?date=YYYY-MM-DD */
export const getDailyReport = async (req, res, next) => {
  try {
    const result = await attendanceService.getDailyReport(req.currentTenantId, req.query.date);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** GET /api/attendance/reports/range?from=&to=&person_id= */
export const getRangeReport = async (req, res, next) => {
  try {
    const result = await attendanceService.getRangeReport(req.currentTenantId, {
      from:      req.query.from,
      to:        req.query.to,
      personId:  req.query.person_id,
    });
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};
