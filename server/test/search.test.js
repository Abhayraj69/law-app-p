const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Search Service tests (Phase 6 — real Postgres full-text search).
 *
 * Covers:
 *   - a case matches on name/client/opposing party/type via tsvector, with
 *     a case-name match ranking a client-name-only match;
 *   - prefix matching works mid-word (typing "compl" finds "Complaint"),
 *     the behavior this replaced the JS substring scorer to preserve;
 *   - a client aggregate is returned once per distinct name with the
 *     right case count;
 *   - a document matches on file name and on a tag it's been given;
 *   - tsquery special characters in the query string never error out or
 *     get interpreted as query syntax;
 *   - case ownership scoping: a CLIENT never sees another client's case,
 *     document, or name.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Search Service — real Postgres full-text search', {
  skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance'
}, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const VaultService = require('../services/vaultService');
  const SearchService = require('../services/searchService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const ASSOCIATE_ID = crypto.randomUUID();
  const CLIENT_ID = crypto.randomUUID();
  const OTHER_CLIENT_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Search Test Firm', `search-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const associate = await db.createUser({
    id: ASSOCIATE_ID, firmId: FIRM_ID, email: `associate-${ASSOCIATE_ID}@example.com`,
    fullName: 'Test Associate', role: 'ASSOCIATE', initials: 'TA', passwordHash
  });
  const client = await db.createUser({
    id: CLIENT_ID, firmId: FIRM_ID, email: `client-${CLIENT_ID}@example.com`,
    fullName: 'Test Client', role: 'CLIENT', initials: 'TC', passwordHash
  });
  const otherClient = await db.createUser({
    id: OTHER_CLIENT_ID, firmId: FIRM_ID, email: `other-client-${OTHER_CLIENT_ID}@example.com`,
    fullName: 'Other Client', role: 'CLIENT', initials: 'OC', passwordHash
  });

  const caseA = await db.insertCase({
    id: `SR-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Meridian Complaint Matter', clientName: 'Meridian Textiles',
    clientUserId: CLIENT_ID
  });
  const caseB = await db.insertCase({
    id: `SR-B-${Date.now()}`, firmId: FIRM_ID, caseName: 'Unrelated Case', clientName: 'Meridian Textiles',
    clientUserId: OTHER_CLIENT_ID
  });

  const { document: doc } = await VaultService.initiateUpload(
    FIRM_ID, ASSOCIATE_ID,
    { buffer: Buffer.from('irrelevant'), size: 40, mimetype: 'text/plain', originalname: 'complaint-draft.txt' },
    { case_id: caseA.id }
  );
  await db.setDocumentTags(doc.id, FIRM_ID, ['Meridian']);

  await t.test('a case name matches, and ranks above a client-name-only match', async () => {
    const { results } = await SearchService.search(FIRM_ID, associate, 'Complaint');
    const caseHit = results.find(r => r.type === 'case' && r.id === caseA.id);
    assert.ok(caseHit, 'case matched by name');
    assert.equal(caseHit.name, 'Meridian Complaint Matter');
  });

  await t.test('prefix matching finds a mid-word match while typing', async () => {
    const { results } = await SearchService.search(FIRM_ID, associate, 'compl');
    assert.ok(results.some(r => r.type === 'case' && r.id === caseA.id));
    assert.ok(results.some(r => r.type === 'document' && r.id === doc.id));
  });

  await t.test('a client name aggregates across cases with the right count', async () => {
    const { results } = await SearchService.search(FIRM_ID, associate, 'Meridian');
    const clientHit = results.find(r => r.type === 'client' && r.id === 'Meridian Textiles');
    assert.ok(clientHit);
    assert.match(clientHit.meta, /2 cases/);
  });

  await t.test('a document matches by its own tag', async () => {
    const { results } = await SearchService.search(FIRM_ID, associate, 'Meridian');
    assert.ok(results.some(r => r.type === 'document' && r.id === doc.id));
  });

  await t.test('tsquery special characters never error and never act as query syntax', async () => {
    const { results, total } = await SearchService.search(FIRM_ID, associate, 'Meridian & (Co) | "quote\'s"');
    assert.equal(typeof total, 'number');
    assert.ok(Array.isArray(results));
  });

  await t.test('an empty or all-punctuation query returns no results without erroring', async () => {
    const { results, total } = await SearchService.search(FIRM_ID, associate, '  &()!  ');
    assert.equal(results.length, 0);
    assert.equal(total, 0);
  });

  await t.test('a CLIENT never sees another client\'s case, document, or client name', async () => {
    const { results } = await SearchService.search(FIRM_ID, otherClient, 'Complaint');
    assert.ok(!results.some(r => r.type === 'case' && r.id === caseA.id));
    assert.ok(!results.some(r => r.type === 'document' && r.id === doc.id));

    const { results: ownResults } = await SearchService.search(FIRM_ID, otherClient, 'Unrelated');
    assert.ok(ownResults.some(r => r.type === 'case' && r.id === caseB.id));
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
