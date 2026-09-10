const { Pool } = require('pg');

/**
 * PostgreSQL Connection Pool
 *
 * This is the ONLY place a `pg.Pool` is constructed. Every other module
 * that needs the database requires this file, never `pg` directly, so
 * connection config lives in one place.
 *
 * Accepts either DATABASE_URL (a full connection string) or the discrete
 * PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT vars that `pg` and most
 * Postgres tooling (psql, pg_dump) already read by convention. DATABASE_URL
 * wins if both are set.
 */
function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
    };
  }

  if (!process.env.PGHOST || !process.env.PGDATABASE) {
    throw new Error(
      'No database configuration found. Set DATABASE_URL, or PGHOST + PGDATABASE ' +
      '(and typically PGUSER/PGPASSWORD/PGPORT), before starting the server. ' +
      'Copy .env.example to .env.local and fill in real values.'
    );
  }

  return {
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

const pool = new Pool(buildPoolConfig());

pool.on('error', (err) => {
  // A pooled client emitting an error (e.g. connection dropped while idle)
  // must not crash the process — just log it. Queries in flight already
  // get their own rejected promise.
  console.error('[DB] Unexpected error on idle client:', err.message);
});

/**
 * Verify the pool can actually reach the database. Call this once at boot
 * and fail fast (exit) rather than letting the first request discover it.
 */
async function checkConnection() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

module.exports = { pool, checkConnection };
