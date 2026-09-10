const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Confirms login/session resolution works against real Postgres-backed
 * users (not the old in-memory store). Requires TEST_DATABASE_URL, same as
 * server/test/persistence.test.js.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('auth against Postgres', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const authService = require('../services/authService');

  await runMigrations();

  const FIRM_ID = '33333333-3333-3333-3333-333333333333';
  const USER_ID = '44444444-4444-4444-4444-444444444444';
  const EMAIL = `auth-test-${Date.now()}@example.com`;
  const PASSWORD = 'correct-horse-battery-staple';

  await pool.query(
    `INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [FIRM_ID, 'Auth Test Firm', `auth-test-${Date.now()}.example`]
  );
  await db.createUser({
    id: USER_ID,
    firmId: FIRM_ID,
    email: EMAIL,
    fullName: 'Auth Tester',
    role: 'ASSOCIATE',
    initials: 'AT',
    passwordHash: bcrypt.hashSync(PASSWORD, 10)
  });

  await t.test('correct credentials resolve to the user', async () => {
    const user = await authService.verifyCredentials(EMAIL, PASSWORD);
    assert.equal(user.id, USER_ID);
    assert.equal(user.email.toLowerCase(), EMAIL.toLowerCase());
  });

  await t.test('wrong password is rejected', async () => {
    await assert.rejects(
      () => authService.verifyCredentials(EMAIL, 'wrong-password'),
      /Invalid email or password/
    );
  });

  await t.test('unknown email is rejected with the same message (no account enumeration)', async () => {
    await assert.rejects(
      () => authService.verifyCredentials('nobody@example.com', PASSWORD),
      /Invalid email or password/
    );
  });

  await t.test('a token issued for the user resolves back to the live Postgres record', async () => {
    const user = await authService.verifyCredentials(EMAIL, PASSWORD);
    const token = authService.issueToken(user);
    const resolved = await authService.resolveUserFromToken(token);
    assert.equal(resolved.id, USER_ID);
  });

  await t.test('data (and login) survive closing and reopening the pool', async () => {
    await pool.end();
    const { Pool } = require('pg');
    const freshPool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await freshPool.query('SELECT * FROM users WHERE id = $1', [USER_ID]);
      assert.equal(rows.length, 1);
      assert.ok(bcrypt.compareSync(PASSWORD, rows[0].password_hash));
    } finally {
      await freshPool.end();
    }
  });
});
