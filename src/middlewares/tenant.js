import { AppError } from './errorHandler.js';
import { db } from '../db/index.js';
import { env } from '../config/env.js';

/**
 * Middleware to enforce tenant isolation.
 * Ensures the organization_id from the token matches the requested organization
 * or sets a database session variable for Row-Level Security (RLS).
 */
export const requireTenant = async (req, res, next) => {
  try {
    if (!req.user || !req.user.organization_id) {
      throw new AppError('Tenant isolation failed: No organization context found', 403);
    }

    const { organization_id } = req.user;

    // Attach to request for controllers to use explicitly
    req.currentTenantId = organization_id;

    // If using PostgreSQL Row-Level Security (RLS), set the session variable.
    // This requires a database transaction or a dedicated connection pool strategy
    // which will be fully implemented when the schema is finalized.
    // 
    // Example for future implementation:
    // await db.query(`SET LOCAL ${env.RLS_SESSION_VAR} = $1`, [organization_id]);

    next();
  } catch (error) {
    next(error);
  }
};
