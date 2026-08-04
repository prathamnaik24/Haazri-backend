import { Router } from 'express';
import { db } from '../db/index.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const start = Date.now();
    let dbStatus = 'disconnected';
    let dbTime = null;

    try {
      const resDb = await db.checkConnection();
      dbStatus = 'connected';
      dbTime = resDb.now;
    } catch (dbError) {
      console.error('Database connection failed in health check:', dbError.message);
    }

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      latencyMs: Date.now() - start,
      database: {
        status: dbStatus,
        time: dbTime,
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
