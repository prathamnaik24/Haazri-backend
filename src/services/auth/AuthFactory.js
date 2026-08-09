import { OrgAuthService } from './OrgAuthService.js';
import { EmployeeAuthService } from './EmployeeAuthService.js';
import { AppError } from '../../middlewares/errorHandler.js';

/**
 * AuthFactory
 *
 * Factory pattern for authentication — creates the right auth service
 * based on the login type requested.
 *
 * Login types:
 *   'org'      — Organization admin login (HR, executives)
 *   'employee' — Standard employee login (scoped to an org by slug)
 *
 * Adding a new login type in the future (e.g., 'sso', 'magic_link')
 * only requires adding a new case here and a new Service file.
 */
export class AuthFactory {
  static create(type) {
    switch (type) {
      case 'org':
        return new OrgAuthService();
      case 'employee':
        return new EmployeeAuthService();
      default:
        throw new AppError(`Unsupported authentication type: "${type}"`, 400);
    }
  }
}
