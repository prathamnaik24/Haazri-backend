/**
 * Utility functions for generating and verifying JSON Web Tokens (JWT)
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Generates an access token and a refresh token for a user
 * @param {Object} payload - Data to encode in the token (e.g., id, organization_id, role)
 * @returns {Object} { accessToken, refreshToken }
 */
export const generateTokens = (payload) => {
  const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET || 'fallback_access_secret_do_not_use_in_prod', {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN || '15m',
  });

  const refreshToken = jwt.sign({ id: payload.id }, env.JWT_REFRESH_SECRET || 'fallback_refresh_secret_do_not_use_in_prod', {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN || '7d',
  });

  return { accessToken, refreshToken };
};

/**
 * Verifies an access token
 * @param {string} token 
 * @returns {Object} decoded payload
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.JWT_ACCESS_SECRET || 'fallback_access_secret_do_not_use_in_prod');
};

/**
 * Verifies a refresh token
 * @param {string} token 
 * @returns {Object} decoded payload
 */
export const verifyRefreshToken = (token) => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET || 'fallback_refresh_secret_do_not_use_in_prod');
};
