import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import router from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';

const app = express();

// Standard middlewares
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser / local requests
    if (!origin) return callback(null, true);
    // Allow any localhost / 127.0.0.1 origin in development
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    if (env.CORS_ORIGIN && (env.CORS_ORIGIN === '*' || origin === env.CORS_ORIGIN)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount all API routes
app.use('/api', router);

// Central error handler (must be last)
app.use(errorHandler);

export default app;
