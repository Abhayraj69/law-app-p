require('../env');

const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');
const logger = require('../utils/logger');

/**
 * Migration Runner
 *
 * Applies db/schema.sql first (the baseline schema), then any numbered
 * *.sql files under db/migrations/ in ascending order, skipping anything
 * already recorded in schema_migrations. Each file runs inside its own
 * transaction; a failing file rolls back and aborts the whole run — this
 * never swallows an error and calls it success.
 *
 * Run via `npm run migrate`, and automatically at server boot (see
 * server/server.js) so a fresh environment is never left half-migrated.
 */

const SCHEMA_FILE = path.join(__dirname, '..', '..', 'db', 'schema.sql');
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function alreadyApplied(client, name) {
  const result = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
  return result.rowCount > 0;
}

async function applyFile(client, name, absolutePath) {
  const sql = fs.readFileSync(absolutePath, 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    logger.info('Applied migration', { context: 'MIGRATE', file: name });
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration '${name}' failed and was rolled back: ${err.message}`);
  }
}

function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // filenames are expected to be zero-padded numeric prefixes, e.g. 0001_*.sql
}

// Arbitrary fixed key for a session-level advisory lock, scoped to this
// migration runner (see below for why it's needed). pg_advisory_lock takes
// a bigint — kept well under Number.MAX_SAFE_INTEGER so it round-trips
// through JS/node-pg with no floating-point precision loss.
const MIGRATION_LOCK_KEY = 72847301;

async function runMigrations() {
  const client = await pool.connect();
  try {
    // Two processes can legitimately call runMigrations() concurrently
    // (e.g. two `node --test` files each booting their own instance of
    // the app against the same test database) — without serializing them,
    // both can pass the same `alreadyApplied` check before either commits,
    // and both then try to run the same file. CREATE TABLE/ALTER COLUMN
    // IF NOT EXISTS tolerate that, but a bare CREATE TYPE does not — it
    // has no idempotent form, so the loser hits a hard "already exists"
    // error and the whole migration (and the test relying on it) fails.
    // A session-level advisory lock held for the duration of this
    // function makes concurrent callers queue instead of racing; it's
    // released automatically if the connection drops, so it can't leak
    // past a crash.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);

    await ensureMigrationsTable(client);

    const baselineName = '0000_schema.sql';
    if (!(await alreadyApplied(client, baselineName))) {
      await applyFile(client, baselineName, SCHEMA_FILE);
    }

    for (const file of listMigrationFiles()) {
      if (await alreadyApplied(client, file)) continue;
      await applyFile(client, file, path.join(MIGRATIONS_DIR, file));
    }

    logger.info('Database schema is up to date.', { context: 'MIGRATE' });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error('Migration run failed', { context: 'MIGRATE', error: err.message });
      pool.end().finally(() => process.exit(1));
    });
}
