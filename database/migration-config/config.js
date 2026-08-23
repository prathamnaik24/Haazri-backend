import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from monorepo root (two levels up from database/migration-config/)
dotenv.config({ path: resolve(__dirname, '../../.env') });

export default {
  // The database connection string
  databaseUrl: process.env.DATABASE_URL || {
    host:     process.env.DB_HOST     || 'localhost',
    port:     process.env.DB_PORT     || 5432,
    database: process.env.DB_NAME     || 'attendance_db',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },

  // Table that node-pg-migrate uses internally to track which migrations have run
  migrationsTable: 'pgmigrations',

  // Where migration files are stored
  dir: 'database/migrations',

  // Default direction when running `npm run db:migrate`
  direction: 'up',

  // Automatically convert camelCase to snake_case in generated file names
  decamelize: true,

  // Verbose output for easier debugging
  verbose: true,
};
