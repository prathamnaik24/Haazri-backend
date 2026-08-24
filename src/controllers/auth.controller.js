import { AuthFactory } from '../services/auth/AuthFactory.js';
import { AppError } from '../middlewares/errorHandler.js';
import { InviteService } from '../services/auth/InviteService.js';
import { db } from '../db/index.js';
import bcrypt from 'bcryptjs';

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
 * Returns the currently authenticated user's profile and roles.
 * Protected route — requireAuth middleware must run before this.
 */
export const getMe = async (req, res, next) => {
  try {
    const personRes = await db.query(
      `SELECT p.id, p.first_name, p.last_name, p.email, p.employee_id, p.phone_number, p.avatar_url, p.organization_id, o.name as org_name, o.slug as org_slug
       FROM persons p
       JOIN organizations o ON p.organization_id = o.id
       WHERE p.id = $1`,
      [req.user.person_id]
    );

    if (personRes.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    res.status(200).json({
      status: 'success',
      data: { user: { ...req.user, ...personRes.rows[0] } },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/auth/profile
 *
 * Updates the current user's profile (first_name, last_name, phone_number).
 */
export const updateProfile = async (req, res, next) => {
  try {
    const { first_name, last_name, phone_number } = req.body;
    const personId = req.user.person_id;

    const fields = [];
    const values = [personId];
    let vIdx = 2;

    if (first_name !== undefined) {
      fields.push(`first_name = $${vIdx++}`);
      values.push(first_name.trim());
    }
    if (last_name !== undefined) {
      fields.push(`last_name = $${vIdx++}`);
      values.push(last_name.trim());
    }
    if (phone_number !== undefined) {
      fields.push(`phone_number = $${vIdx++}`);
      values.push(phone_number ? phone_number.trim() : null);
    }

    if (fields.length === 0) {
      throw new AppError('No profile fields provided to update', 400);
    }

    fields.push(`updated_at = current_timestamp`);

    const result = await db.query(
      `UPDATE persons 
       SET ${fields.join(', ')}
       WHERE id = $1
       RETURNING id, first_name, last_name, email, employee_id, phone_number`,
      values
    );

    if (result.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: { user: result.rows[0] },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/change-password
 *
 * Changes the current user's password.
 * Body: { currentPassword, newPassword }
 */
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const personId = req.user.person_id;

    if (!currentPassword || !newPassword) {
      throw new AppError('Current password and new password are required', 400);
    }

    if (newPassword.length < 8) {
      throw new AppError('New password must be at least 8 characters long', 400);
    }

    const personRes = await db.query(
      'SELECT id, password_hash, organization_id FROM persons WHERE id = $1',
      [personId]
    );

    if (personRes.rows.length === 0) {
      throw new AppError('User not found', 404);
    }

    const person = personRes.rows[0];

    const isMatch = await bcrypt.compare(currentPassword, person.password_hash);
    if (!isMatch) {
      throw new AppError('The current password you entered is incorrect', 400);
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await db.query(
      'UPDATE persons SET password_hash = $1, updated_at = current_timestamp WHERE id = $2',
      [newHash, personId]
    );

    await db.query(
      `INSERT INTO audit_logs (organization_id, entity_type, entity_id, action, changed_by, reason)
       VALUES ($1, 'person', $2, 'UPDATE', $2, 'User changed account password')`,
      [person.organization_id, personId]
    );

    res.status(200).json({
      status: 'success',
      message: 'Password updated successfully',
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/invite/accept
 * Consumes the registration invite token and sets the employee password.
 */
export const acceptInvite = async (req, res, next) => {
  try {
    const { token, password } = req.body;

    const inviteService = new InviteService();
    const result = await inviteService.acceptInvite(token, password);

    res.status(200).json({
      status: 'success',
      message: result.message,
      data: { email: result.email },
    });
  } catch (err) {
    next(err);
  }
};
