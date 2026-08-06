/**
 * Employee Auth Service
 * Handles login logic for standard employees and students
 */
import { generateTokens } from '../../utils/token.js';
// import { db } from '../../db/index.js'; // Will be used when schema is ready

export class EmployeeAuthService {
  /**
   * Authenticate an employee
   * @param {Object} credentials - { organization_slug, email, password }
   */
  async login(credentials) {
    const { organization_slug, email, password } = credentials;
    
    // TODO: 1. Find organization by slug
    // TODO: 2. Find person by email and organization_id
    // TODO: 3. Verify password hash
    // TODO: 4. Fetch person's primary position path (ltree)
    
    // Mock response for now
    const mockUser = {
      id: 'mock-user-uuid',
      organization_id: 'mock-org-uuid',
      position_path: 'acme.engineering.backend.developer',
      role: 'employee'
    };

    const tokens = generateTokens(mockUser);
    
    return {
      user: mockUser,
      tokens
    };
  }
}
