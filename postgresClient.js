const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_POSTGRES_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('Missing Postgres connection string. Set DATABASE_URL to your Supabase Postgres URI.');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

module.exports = pool;