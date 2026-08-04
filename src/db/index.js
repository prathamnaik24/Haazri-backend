import { pool } from '../config/db.js';

export const db = {
  /**
   * Run a query on the pool
   * @param {string} text 
   * @param {any[]} params 
   */
  query: (text, params) => {
    return pool.query(text, params);
  },
  
  /**
   * Get a client from the pool for transactions
   */
  getClient: () => {
    return pool.connect();
  },

  /**
   * Check connection status
   */
  checkConnection: async () => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT NOW()');
      return res.rows[0];
    } finally {
      client.release();
    }
  }
};
