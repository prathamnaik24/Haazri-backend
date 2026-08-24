import { ReportService } from '../../services/admin/ReportService.js';

export const getAttendanceReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const report = await ReportService.getAttendanceReport(req.user.organization_id, startDate, endDate);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getLeaveReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const report = await ReportService.getLeaveReport(req.user.organization_id, startDate, endDate);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
