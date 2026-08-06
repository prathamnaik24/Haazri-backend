import { verifyAccessToken } from '../utils/token.js';
import { AppError } from './errorHandler.js';

/**
 * Middleware to protect routes that require authentication
 * Extracts JWT from the Authorization header and verifies it.
 */
export const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Unauthorized: Missing or invalid token', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

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
