import { AppError } from '../middlewares/errorHandler.js';

/**
 * Middleware factory to require a specific permission.
 * Assumes that req.user.permissions is an array of permission strings.
 * If not present, it will throw a 403 error.
 */
export const requirePermission = (requiredPermission) => (req, res, next) => {
  try {
    const isOrgAdmin = req.user && (
      req.user.type === 'org_admin' || 
      (Array.isArray(req.user.roles) && req.user.roles.some(r => r.toLowerCase() === 'org admin'))
    );
    if (isOrgAdmin) {
      return next();
    }
    const userPermissions = req.user && Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (userPermissions.includes(requiredPermission)) {
      return next();
    }
    if (requiredPermission === 'view_hierarchy' && req.user && req.user.person_id) {
      return next();
    }
    throw new AppError(`Forbidden: Missing required permission '${requiredPermission}'`, 403);
  } catch (err) {
    next(err);
  }
};
