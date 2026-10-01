const fs = require('node:fs');
const { Pool, types } = require('pg');
const logger = require('../utils/logger');

/**
 * PostgreSQL Connection Pool
 *
 * This is the ONLY place a `pg.Pool` is constructed. Every other module
 * that needs the database requires this file, never `pg` directly, so
 * connection config lives in one place.
 *
 * node-pg's default DATE (oid 1082) parser builds a JS `Date` at LOCAL
 * midnight for the value, which silently shifts the date by one day as
 * soon as anything reads it back with a UTC-based method (getUTCDate,
 * toISOString, …) on a host whose timezone is ahead of UTC — e.g. a
 * `deadline_date` of 2026-07-21 becomes "2026-07-20T18:30:00.000Z" on a
 * UTC+5:30 host. DATE columns (case_deadlines.deadline_date,
 * invoices.issued_date/due_date/paid_date) are calendar dates with no
 * time-of-day or timezone component, so they're kept as the plain
 * 'YYYY-MM-DD' string Postgres sends over the wire instead — callers
 * format that directly rather than constructing a Date from it.
 *
 * TIMESTAMPTZ columns (created_at, updated_at, etc.) are unaffected and
 * keep node-pg's normal Date parsing.
 *
 * Accepts either DATABASE_URL (a full connection string) or the discrete
 * PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT vars that `pg` and most
 * Postgres tooling (psql, pg_dump) already read by convention. DATABASE_URL
 * wins if both are set.
 */
types.setTypeParser(1082, (val) => val);

// When PGSSL is enabled, verify the server's certificate by default —
// rejectUnauthorized:false encrypts the connection but never authenticates
// the server, so anything able to intercept the route to the database can
// present its own certificate and read or alter every query (privileged
// client documents, messages, trust-account movements). PGSSL_INSECURE
// exists only as a deliberate, visible escape hatch for a self-signed dev
// database — it must never be set in production.
function buildSsl() {
  if (process.env.PGSSL !== 'true') return false;
  const ssl = {
    rejectUnauthorized: process.env.PGSSL_INSECURE !== 'true'
  };
  if (process.env.PGSSLROOTCERT) {
    ssl.ca = fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8');
  }
  return ssl;
}

// Pool sizing — previously left at node-pg's default (max: 10) with no
// idle/connection timeouts. Keep `max` × instance count below the
// database's own connection limit.
const POOL_SIZING = {
  max: process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : 10,
  idleTimeoutMillis: process.env.PG_IDLE_TIMEOUT_MS ? parseInt(process.env.PG_IDLE_TIMEOUT_MS, 10) : 30000,
  connectionTimeoutMillis: process.env.PG_CONNECTION_TIMEOUT_MS ? parseInt(process.env.PG_CONNECTION_TIMEOUT_MS, 10) : 5000
};

function buildPoolConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: buildSsl(),
      ...POOL_SIZING
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
    ssl: buildSsl(),
    ...POOL_SIZING
  };
}

// The real pg.Pool is built lazily, on first actual use, not here at
// module load. Plenty of modules (ConflictCheckService, etc.) require this
// file transitively (via server/db.js) just to reach a handful of
// functions that never touch the database — e.g. ConflictCheckService.
// normalizeName is pure string logic. Building the Pool eagerly meant
// simply requiring those modules threw "No database configuration found"
// on a fresh clone with no .env.local, which broke unit tests that have
// nothing to do with Postgres. `pool` below is a Proxy that defers
// buildPoolConfig() (and its throw) until the first property access —
// i.e. the first real `pool.query(...)`/`pool.connect()`/`pool.end()` call.
let realPool = null;

function getPool() {
  if (!realPool) {
    realPool = new Pool(buildPoolConfig());
    realPool.on('error', (err) => {
      // A pooled client emitting an error (e.g. connection dropped while idle)
      // must not crash the process — just log it. Queries in flight already
      // get their own rejected promise.
      logger.error('Unexpected error on idle client', { context: 'DB', error: err.message });
    });
  }
  return realPool;
}

const pool = new Proxy({}, {
  get(target, prop, receiver) {
    const value = getPool()[prop];
    return typeof value === 'function' ? value.bind(realPool) : value;
  }
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

module.exports = { pool, checkConnection, buildPoolConfig };
