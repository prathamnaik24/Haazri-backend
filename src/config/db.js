import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

const poolConfig = env.DB.url 
  ? { connectionString: env.DB.url }
  : {
      host: env.DB.host,
      port: env.DB.port,
      database: env.DB.database,
      user: env.DB.user,
      password: env.DB.password,
    };

export const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Used by tests to cleanly shut down the connection pool after all tests run
export const closePool = () => pool.end();
