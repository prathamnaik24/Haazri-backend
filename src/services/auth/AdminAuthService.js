/**
 * Admin Auth Service
 * Handles login logic for system administrators and HR executives
 */
import { generateTokens } from '../../utils/token.js';
// import { db } from '../../db/index.js'; // Will be used when schema is ready

export class AdminAuthService {
  /**
   * Authenticate an admin
   * @param {Object} credentials - { email, password }
   */
  async login(credentials) {
    const { email, password } = credentials;
    
    // TODO: 1. Find person by email (can be system-wide or cross-tenant)
    // TODO: 2. Verify password hash
    // TODO: 3. Verify they have an admin role
    
    // Mock response for now
    const mockAdmin = {
      id: 'mock-admin-uuid',
      organization_id: null, // System admin
      position_path: 'system.admin',
      role: 'system_admin'
    };

    const tokens = generateTokens(mockAdmin);
    
    return {
      user: mockAdmin,
      tokens
    };
  }
}
