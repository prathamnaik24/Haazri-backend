/**
 * Utility functions for generating and verifying JSON Web Tokens (JWT)
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Generates an access token and a refresh token for a user
 * @param {Object} payload - Data to encode in the token (e.g., person_id, organization_id, type)
 * @returns {Object} { accessToken, refreshToken }
 */
export const generateTokens = (payload) => {
  const accessToken = jwt.sign(payload, env.JWT.accessSecret, {
    expiresIn: '15m',
  });

  const refreshToken = jwt.sign({ person_id: payload.person_id }, env.JWT.refreshSecret, {
    expiresIn: '7d',
  });

  return { accessToken, refreshToken };
};

/**
 * Verifies an access token
 * @param {string} token
 * @returns {Object} decoded payload
 */
export const verifyAccessToken = (token) => {
  return jwt.verify(token, env.JWT.accessSecret);
};

/**
 * Verifies a refresh token
 * @param {string} token
 * @returns {Object} decoded payload
 */
export const verifyRefreshToken = (token) => {
  return jwt.verify(token, env.JWT.refreshSecret);
};

