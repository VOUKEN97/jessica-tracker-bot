const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
});

// Initialize table
pool.query(`
  CREATE TABLE IF NOT EXISTS shifts (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      location TEXT,
      date TEXT,
      start_time TEXT,
      end_time TEXT,
      notes TEXT,
      fee INTEGER DEFAULT 0
  )
`).catch(err => console.error("DB Init Error:", err));

module.exports = pool;
