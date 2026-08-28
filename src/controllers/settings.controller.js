import { SettingsService } from '../services/settings.service.js';

const settingsService = new SettingsService();

/** GET /api/settings/reporting-time */
export const getReportingTime = async (req, res, next) => {
  try {
    const result = await settingsService.getReportingTime(req.currentTenantId);
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};

/** PUT /api/settings/reporting-time */
export const setReportingTime = async (req, res, next) => {
  try {
    const result = await settingsService.setReportingTime(
      req.currentTenantId, req.user.person_id, req.body
    );
    res.status(200).json({ status: 'success', data: result });
  } catch (err) { next(err); }
};
