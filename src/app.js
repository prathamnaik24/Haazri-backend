import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import healthRouter from './routes/health.js';
import { errorHandler } from './middlewares/errorHandler.js';

const app = express();

// Standard middlewares
app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true
}));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes mounting
app.use('/api/health', healthRouter);

// Central error handler
app.use(errorHandler);

export default app;
