/**
 * requireRole middleware
 * Usage: requireRole('Org Admin', 'HR Manager')
 * Passes if the authenticated user has ANY of the specified roles.
 */
export const requireRole = (...allowedRoles) => (req, res, next) => {
  const userRoles = req.user?.roles || [];
  if (req.user?.type === 'org_admin' || userRoles.includes('Org Admin') || userRoles.includes('CEO')) {
    return next();
  }
  const allowed = allowedRoles.some((r) => userRoles.includes(r));
  if (!allowed) {
    return res.status(403).json({
      status: 'error',
      message: 'You do not have permission to perform this action',
    });
  }
  next();
};
