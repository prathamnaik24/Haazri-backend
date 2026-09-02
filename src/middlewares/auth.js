import { verifyAccessToken } from '../utils/token.js';
import { AppError } from './errorHandler.js';
import { db } from '../db/index.js';

/**
 * Middleware to protect routes that require authentication
 * Extracts JWT from the Authorization header and verifies it.
 */
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Unauthorized: Missing or invalid token', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    // Fetch permissions from the database in real-time based on roles
    let permissions = [];
    if (decoded.roles && decoded.roles.includes('Org Admin')) {
      const allPermsRes = await db.query('SELECT name FROM permissions');
      permissions = allPermsRes.rows.map(r => r.name);
    } else {
      const permissionsRes = await db.query(
        `SELECT DISTINCT p.name 
         FROM person_roles pr
         JOIN role_permissions rp ON pr.role_id = rp.role_id
         JOIN permissions p ON rp.permission_id = p.id
         WHERE pr.person_id = $1`,
        [decoded.person_id]
      );
      permissions = permissionsRes.rows.map(r => r.name);
    }
    
    decoded.permissions = permissions;

    // Fetch live primary position_path from database in real-time to support dynamic org changes
    const posRes = await db.query(
      `SELECT pos.path::text AS position_path
       FROM position_assignments pa
       JOIN positions pos ON pos.id = pa.position_id
       WHERE pa.person_id = $1 AND pa.is_primary = true
         AND (pa.end_date IS NULL OR pa.end_date >= CURRENT_DATE)
       LIMIT 1`,
      [decoded.person_id]
    );
    decoded.position_path = posRes.rows[0]?.position_path || decoded.position_path;

    // Attach user data to the request object
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      next(new AppError('Unauthorized: Token has expired', 401));
    } else if (error.name === 'JsonWebTokenError') {
      next(new AppError('Unauthorized: Invalid token', 401));
    } else {
      next(error);
    }
  }
};

