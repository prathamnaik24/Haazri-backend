import { EmployeeAuthService } from './EmployeeAuthService.js';
import { AdminAuthService } from './AdminAuthService.js';

/**
 * Factory for creating the appropriate authentication service
 * based on the user's login type.
 */
export class AuthFactory {
  static create(type) {
    switch (type) {
      case 'employee':
        return new EmployeeAuthService();
      case 'admin':
        return new AdminAuthService();
      // Future expansions: 'sso', 'magic_link', etc.
      default:
        throw new Error(`Unsupported authentication type: ${type}`);
    }
  }
}
