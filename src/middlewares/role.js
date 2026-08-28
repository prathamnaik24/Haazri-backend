import { AppError } from '../middlewares/errorHandler.js';

/**
 * Middleware factory to require a specific permission.
 * Assumes that req.user.permissions is an array of permission strings.
 * If not present, it will throw a 403 error.
 */
export const requirePermission = (requiredPermission) => (req, res, next) => {
  try {
    const userPermissions = req.user && Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (!userPermissions.includes(requiredPermission)) {
      throw new AppError(`Forbidden: Missing required permission '${requiredPermission}'`, 403);
    }
    next();
  } catch (err) {
    next(err);
  }
};
