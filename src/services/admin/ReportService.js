import { db } from '../../db/index.js';

export class ReportService {
  static async getAttendanceReport(orgId, startDate = '1970-01-01', endDate = '2099-12-31') {
    const sDate = startDate || '1970-01-01';
    const eDate = endDate || '2099-12-31';
    const res = await db.query(`
      SELECT p.id as person_id, p.employee_id, p.first_name, p.last_name, count(a.id) as days_present 
      FROM persons p
      LEFT JOIN attendance a ON p.id = a.person_id AND a.work_date >= $2 AND a.work_date <= $3
      WHERE p.organization_id = $1
      GROUP BY p.id, p.employee_id, p.first_name, p.last_name
    `, [orgId, sDate, eDate]);
    return res.rows;
  }

  static async getLeaveReport(orgId, startDate = '1970-01-01', endDate = '2099-12-31') {
    const sDate = startDate || '1970-01-01';
    const eDate = endDate || '2099-12-31';
    const res = await db.query(`
      SELECT p.id as person_id, p.employee_id, p.first_name, p.last_name, l.status, count(l.id) as total_leaves
      FROM persons p
      JOIN leave_requests l ON p.id = l.person_id
      WHERE p.organization_id = $1 AND l.start_date >= $2 AND l.end_date <= $3
      GROUP BY p.id, p.employee_id, p.first_name, p.last_name, l.status
    `, [orgId, sDate, eDate]);
    return res.rows;
  }
}
