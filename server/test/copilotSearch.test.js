const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tests for the AI Copilot's searchVault tool's "cases" scope.
 *
 * Before this, "cases" search results came from a pseudo-case view
 * derived from documents.case_id (fabricated status: 'ACTIVE' for every
 * result, lead_attorney was actually the last document's uploader, no
 * relation to the real cases table createOrUpdateCase writes to — see
 * server/test/copilotCase.test.js). These tests prove search now reads
 * the real `cases` table (so a status/attorney change made via
 * createOrUpdateCase is actually reflected in search results) AND is
 * role-scoped the same way every other case read in this app is: a
 * CLIENT must not be able to search-discover another client's case
 * through the Copilot, even though a direct fetch of it was already
 * blocked (server/test/roleScoping.test.js).
 *
 * Requires a real database via TEST_DATABASE_URL — skipped, not failed,
 * if it isn't set.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

// Minimal Express req/res mocks — searchVault is called directly rather
// than through HTTP, same approach server/test/roleScoping.test.js and
// server/test/copilotCase.test.js already use for calling into
// controllers/services without spinning up a live server.
function mockRes() {
  const res = { body: null };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('AI Copilot searchVault: "cases" scope reads the real cases table, role-scoped', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const { searchVault } = require('../controllers/copilotController');
  const CaseService = require('../services/caseService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const STAFF_ID = crypto.randomUUID();
  const CLIENT_A_ID = crypto.randomUUID();
  const CLIENT_B_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Copilot Search Test Firm', `copilot-search-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  const staff = await db.createUser({ id: STAFF_ID, firmId: FIRM_ID, email: `staff-${STAFF_ID}@example.com`, fullName: 'Test Staff', role: 'ASSOCIATE', initials: 'TS', passwordHash });
  const clientA = await db.createUser({ id: CLIENT_A_ID, firmId: FIRM_ID, email: `client-a-${CLIENT_A_ID}@example.com`, fullName: 'Client Alpha', role: 'CLIENT', initials: 'CA', passwordHash });
  const clientB = await db.createUser({ id: CLIENT_B_ID, firmId: FIRM_ID, email: `client-b-${CLIENT_B_ID}@example.com`, fullName: 'Client Beta', role: 'CLIENT', initials: 'CB', passwordHash });

  const uniqueTag = crypto.randomUUID().slice(0, 8);
  const caseA = await db.insertCase({ id: `SRCH-A-${Date.now()}`, firmId: FIRM_ID, caseName: `Zephyr ${uniqueTag} Matter Alpha`, clientName: 'Client Alpha', clientUserId: CLIENT_A_ID, status: 'urgent' });
  const caseB = await db.insertCase({ id: `SRCH-B-${Date.now()}`, firmId: FIRM_ID, caseName: `Zephyr ${uniqueTag} Matter Beta`, clientName: 'Client Beta', clientUserId: CLIENT_B_ID, status: 'pending' });

  await t.test('staff search returns a real, up-to-date status — not a fabricated "ACTIVE" for every case', async () => {
    const req = { tenantId: FIRM_ID, user: staff, body: { query: uniqueTag, scope: 'cases' } };
    const res = mockRes();
    await searchVault(req, res, () => { throw new Error('next() should not be called on success'); });

    const hitA = res.body.data.results.find(r => r.id === caseA.id);
    const hitB = res.body.data.results.find(r => r.id === caseB.id);
    assert.ok(hitA, 'staff should see case A in search results');
    assert.ok(hitB, 'staff should see case B in search results');
    assert.match(hitA.snippet, /urgent/, 'the real status should appear in the snippet, not a fabricated one');
    assert.match(hitB.snippet, /pending/);
  });

  await t.test('a CLIENT searching cases only finds their OWN case, never another client\'s', async () => {
    const req = { tenantId: FIRM_ID, user: clientA, body: { query: uniqueTag, scope: 'cases' } };
    const res = mockRes();
    await searchVault(req, res, () => { throw new Error('next() should not be called on success'); });

    const ids = res.body.data.results.map(r => r.id);
    assert.ok(ids.includes(caseA.id), 'Client A should find their own case');
    assert.ok(!ids.includes(caseB.id), 'Client A must NOT be able to search-discover Client B\'s case through the Copilot');
  });

  await t.test('a status change made via CaseService (the same path createOrUpdateCase commits through) is immediately reflected in search', async () => {
    await CaseService.applyFieldUpdate(FIRM_ID, caseA.id, { status: 'closed' });

    const req = { tenantId: FIRM_ID, user: staff, body: { query: uniqueTag, scope: 'cases' } };
    const res = mockRes();
    await searchVault(req, res, () => { throw new Error('next() should not be called on success'); });

    const hitA = res.body.data.results.find(r => r.id === caseA.id);
    assert.match(hitA.snippet, /closed/, 'search must read live data, not a stale/derived snapshot');
  });

  // Teardown — every other table references the firm with ON DELETE
  // CASCADE, so removing it removes the rest.
  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
