import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from root directory (two directories up from src/config)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const requiredEnv = [
  'PORT',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
];

// Check for missing environment variables
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.warn(`⚠️ Warning: Missing required environment variables: ${missing.join(', ')}`);
  console.warn('Backend will attempt to start but database connection or server PORT might be broken.');
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5000', 10),
  DB: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'attendance_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    url: process.env.DATABASE_URL
  },
  JWT: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret_key_1234567890',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret_key_1234567890',
  },
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
};
