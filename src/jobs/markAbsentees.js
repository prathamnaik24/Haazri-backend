import cron from 'node-cron';
import { db } from '../db/index.js';

/**
 * Cron job: mark absent employees at end of workday.
 *
 * Runs at 9 PM IST (15:30 UTC) every day.
 * Inserts an attendance row with punctuality_status='ABSENT' for every active
 * employee who has NOT checked in today.
 *
 * Uses ON CONFLICT DO NOTHING so re-runs are safe.
 */
export function startAbsenteeJob() {
  // '30 15 * * *' = 15:30 UTC = 9:00 PM IST
  cron.schedule('30 15 * * *', async () => {
    const runAt = new Date().toISOString();
    console.log(`[CRON] markAbsentees started at ${runAt}`);
    try {
      const result = await db.query(`
        INSERT INTO attendance (person_id, work_date, status, punctuality_status, late_by_minutes, working_minutes)
        SELECT p.id, CURRENT_DATE, 'Absent', 'ABSENT', 0, 0
        FROM persons p
        WHERE p.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM attendance a
            WHERE a.person_id = p.id AND a.work_date = CURRENT_DATE
          )
        ON CONFLICT (person_id, work_date) DO NOTHING
      `);
      console.log(`[CRON] markAbsentees: marked ${result.rowCount} absent employees`);
    } catch (err) {
      console.error('[CRON] markAbsentees error:', err.message);
    }
  });

  console.log('[CRON] Absentee marking job scheduled (daily 9 PM IST)');
}
