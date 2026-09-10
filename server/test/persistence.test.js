const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Integration tests for Postgres persistence.
 *
 * Require a real database via TEST_DATABASE_URL (e.g. a throwaway local
 * or Dockerized Postgres) — these are NOT run against the in-memory
 * fallback because that fallback no longer exists; persistence itself is
 * the thing under test. If TEST_DATABASE_URL isn't set, every test here
 * is skipped with an explanation instead of failing the whole suite.
 *
 * Run with: TEST_DATABASE_URL=postgres://... npm test
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Postgres persistence', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const { Pool } = require('pg');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');

  await runMigrations();

  const TEST_FIRM_ID = '11111111-1111-1111-1111-111111111111';
  const TEST_USER_ID = '22222222-2222-2222-2222-222222222222';

  await pool.query(
    `INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [TEST_FIRM_ID, 'Persistence Test Firm', `persistence-test-${Date.now()}.example`]
  );
  await db.ensureStorageQuota(TEST_FIRM_ID);
  await db.createUser({
    id: TEST_USER_ID,
    firmId: TEST_FIRM_ID,
    email: `persistence-test-${Date.now()}@example.com`,
    fullName: 'Test User',
    role: 'ASSOCIATE',
    initials: 'TU',
    passwordHash: '$2a$10$CwTycUXWue0Thq9StjUM0uJ8u.EWMBB5vTZzHFN.wJm9DNv7tQGGa'
  });

  const folder = await db.insertFolder({
    firmId: TEST_FIRM_ID,
    parentId: null,
    folderName: 'Persistence Test Folder',
    category: 'Case Files',
    createdBy: TEST_USER_ID
  });

  const doc = await db.insertDocument({
    firm_id: TEST_FIRM_ID,
    file_name: 'persisted-doc.pdf',
    original_name: 'persisted-doc.pdf',
    file_type: 'application/pdf',
    extension: 'pdf',
    file_size_bytes: 12345,
    storage_path_url: `${TEST_FIRM_ID}/persisted-doc.pdf`,
    folder_id: folder.id,
    author_id: TEST_USER_ID,
    tags: ['PERSISTENCE-TEST']
  });

  await t.test('data is queryable immediately after insert', async () => {
    const found = await db.getDocumentById(TEST_FIRM_ID, doc.id);
    assert.ok(found, 'document should be findable right after insert');
    assert.equal(found.file_name, 'persisted-doc.pdf');
    assert.deepEqual(found.tags, ['PERSISTENCE-TEST']);
  });

  await t.test('storage quota was incremented by the insert trigger', async () => {
    const quota = await db.getStorageQuota(TEST_FIRM_ID);
    assert.equal(Number(quota.storage_used_bytes), 12345);
  });

  await t.test('data survives closing and reopening the connection pool (simulated restart)', async () => {
    // Close every connection in the current pool — this is what happens to
    // an in-memory store on process exit, except here the data lives in
    // Postgres, not the pool object, so closing the pool must NOT lose it.
    await pool.end();

    // Open a brand new pool against the same database, as a fresh process
    // would on the next boot.
    const freshPool = new Pool({ connectionString: TEST_DB_URL });
    try {
      const { rows } = await freshPool.query('SELECT * FROM documents WHERE id = $1', [doc.id]);
      assert.equal(rows.length, 1, 'document must still exist after the pool was closed and reopened');
      assert.equal(rows[0].file_name, 'persisted-doc.pdf');

      const userRows = await freshPool.query('SELECT * FROM users WHERE id = $1', [TEST_USER_ID]);
      assert.equal(userRows.rows.length, 1, 'user must still exist after the pool was closed and reopened');

      const folderRows = await freshPool.query('SELECT * FROM folders WHERE id = $1', [folder.id]);
      assert.equal(folderRows.rows.length, 1, 'folder must still exist after the pool was closed and reopened');
    } finally {
      await freshPool.end();
    }
  });
});
