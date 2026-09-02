import { db } from '../db/index.js';
import { AppError } from '../middlewares/errorHandler.js';

export class SettingsService {
  /**
   * Get the reporting time setting for an org.
   */
  async getReportingTime(orgId) {
    const res = await db.query(
      `SELECT setting_value AS reporting_time, timezone
       FROM office_settings
       WHERE organization_id = $1 AND setting_key = 'default_reporting_time' AND scope_type = 'org'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [orgId]
    );
    // Return defaults if not yet configured
    return res.rows[0] || { reporting_time: '09:30', timezone: 'Asia/Kolkata' };
  }

  /**
   * Upsert the reporting time setting for an org.
   */
  async setReportingTime(orgId, updatedBy, { reporting_time, timezone }) {
    if (!reporting_time || !/^\d{2}:\d{2}$/.test(reporting_time)) {
      throw new AppError('reporting_time must be in HH:MM format (e.g. "09:30")', 400);
    }

    // Validate time range
    const [h, m] = reporting_time.split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) {
      throw new AppError('reporting_time is not a valid time', 400);
    }

    const tz = timezone || 'Asia/Kolkata';

    const res = await db.query(
      `INSERT INTO office_settings (organization_id, setting_key, setting_value, timezone, scope_type, updated_by)
       VALUES ($1, 'default_reporting_time', $2, $3, 'org', $4)
       ON CONFLICT (organization_id, setting_key, scope_type)
       DO UPDATE SET setting_value = EXCLUDED.setting_value,
                     timezone      = EXCLUDED.timezone,
                     updated_by    = EXCLUDED.updated_by,
                     updated_at    = now()
       RETURNING setting_value AS reporting_time, timezone, updated_at`,
      [orgId, reporting_time, tz, updatedBy]
    );
    return res.rows[0];
  }
}
