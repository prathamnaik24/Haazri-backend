import { AuthFactory } from '../services/auth/AuthFactory.js';
import { AppError } from '../middlewares/errorHandler.js';

/**
 * POST /api/auth/org/register
 *
 * Register a new organization and create its first admin user.
 * Body: { org_name, org_slug, org_type?, admin_first_name, admin_last_name, admin_email, admin_password }
 */
export const registerOrg = async (req, res, next) => {
  try {
    const { org_name, org_slug, org_type, admin_first_name, admin_last_name, admin_email, admin_password } = req.body;

    // Validate required fields
    if (!org_name || !org_slug || !admin_first_name || !admin_last_name || !admin_email || !admin_password) {
      throw new AppError('Missing required fields: org_name, org_slug, admin_first_name, admin_last_name, admin_email, admin_password', 400);
    }

    // Basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(admin_email)) {
      throw new AppError('Invalid email format', 400);
    }

    if (admin_password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400);
    }

    const service = AuthFactory.create('org');
    const result = await service.register({
      org_name,
      // Sanitize slug: lowercase, spaces → hyphens, strip all non-alphanumeric except hyphens
      org_slug: org_slug.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      org_type,
      admin_first_name,
      admin_last_name,
      admin_email: admin_email.toLowerCase().trim(),
      admin_password,
    });

    res.status(201).json({
      status: 'success',
      message: 'Organization registered successfully',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/org/login
 *
 * Login as an organization admin.
 * Body: { email, password }
 */
export const loginOrg = async (req, res, next) => {
  try {
    const { org_slug, email, password } = req.body;

    if (!org_slug || !email || !password) {
      throw new AppError('org_slug, email and password are required', 400);
    }

    const service = AuthFactory.create('org');
    const result = await service.login({
      org_slug: org_slug.toLowerCase(),
      email: email.toLowerCase().trim(),
      password,
    });

    res.status(200).json({
      status: 'success',
      message: 'Login successful',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/employee/login
 *
 * Login as a standard employee.
 * Body: { org_slug, email, password }
 */
export const loginEmployee = async (req, res, next) => {
  try {
    const { org_slug, email, password } = req.body;

    if (!org_slug || !email || !password) {
      throw new AppError('org_slug, email and password are required', 400);
    }

    const service = AuthFactory.create('employee');
    const result = await service.login({
      org_slug: org_slug.toLowerCase(),
      email: email.toLowerCase(),
      password,
    });

    res.status(200).json({
      status: 'success',
      message: 'Login successful',
      data: result,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user's context from the JWT.
 * Protected route — requireAuth middleware must run before this.
 */
export const getMe = async (req, res, next) => {
  try {
    // req.user is populated by the requireAuth middleware
    res.status(200).json({
      status: 'success',
      data: { user: req.user },
    });
  } catch (err) {
    next(err);
  }
};
