const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Upload / case-binding tests.
 *
 * VaultService.initiateUpload used to call db.ensureCase, which INSERTED a
 * cases row for whatever case_id string arrived on the upload — defaulting
 * the case name to the id itself and the client to 'Unknown'. That had two
 * consequences worth locking down with tests:
 *
 *   1. Whatever the client sent became a real PRIMARY KEY. A frontend bug
 *      that passed a click event instead of a case id persisted a case
 *      literally named and keyed "[object PointerEvent]" on every plain
 *      "Upload Files" click. (That frontend bug is fixed separately; this
 *      is the server-side half that let it reach the database at all.)
 *   2. It was a path to creating cases OUTSIDE CaseService.createCase,
 *      skipping its conflict check, its LC-YYYY-NNN id minting, its role
 *      gate and its audit-log entry.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Uploads may only attach to a case that already exists', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const VaultService = require('../services/vaultService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const STAFF_ID = crypto.randomUUID();
  const CLIENT_A_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Upload Binding Firm', `upload-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const staff = await db.createUser({
    id: STAFF_ID, firmId: FIRM_ID, email: `staff-${STAFF_ID}@example.com`,
    fullName: 'Upload Staff', role: 'ASSOCIATE', initials: 'US', passwordHash
  });
  const clientA = await db.createUser({
    id: CLIENT_A_ID, firmId: FIRM_ID, email: `client-${CLIENT_A_ID}@example.com`,
    fullName: 'Upload Client', role: 'CLIENT', initials: 'UC', passwordHash
  });

  const ownCase = await db.insertCase({
    id: `UB-OWN-${Date.now()}`, firmId: FIRM_ID, caseName: 'Client A Matter',
    clientName: 'Upload Client', clientUserId: CLIENT_A_ID
  });
  const otherCase = await db.insertCase({
    id: `UB-OTHER-${Date.now()}`, firmId: FIRM_ID, caseName: 'Someone Else Matter',
    clientName: 'Another Client'
  });

  // A minimal real PNG, so the upload pipeline's magic-byte check passes
  // and the test exercises the case binding rather than failing earlier.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const makeFile = () => ({
    buffer: PNG, size: PNG.length, mimetype: 'image/png', originalname: 'probe.png'
  });

  await t.test('an upload naming a case that does not exist is refused', async () => {
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM cases WHERE firm_id = $1', [FIRM_ID]);

    await assert.rejects(
      () => VaultService.initiateUpload(FIRM_ID, STAFF_ID, makeFile(), { case_id: 'NO-SUCH-CASE-9999' }, staff),
      (err) => err.status === 400 && err.code === 'UNKNOWN_CASE',
      'an unknown case_id must be refused, not silently created'
    );

    const after = await pool.query('SELECT COUNT(*)::int AS n FROM cases WHERE firm_id = $1', [FIRM_ID]);
    assert.equal(after.rows[0].n, before.rows[0].n, 'a refused upload must not have created a case row');
  });

  await t.test('a garbage case_id cannot become a real case primary key', async () => {
    // The exact shape of the bug that produced the "[object PointerEvent]"
    // row: a non-id value arriving where a case id was expected.
    const garbage = '[object PointerEvent]';

    await assert.rejects(
      () => VaultService.initiateUpload(FIRM_ID, STAFF_ID, makeFile(), { case_id: garbage }, staff),
      (err) => err.code === 'UNKNOWN_CASE'
    );

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM cases WHERE firm_id = $1 AND id = $2', [FIRM_ID, garbage]
    );
    assert.equal(rows[0].n, 0, 'the database must not contain a case keyed by a stringified DOM event');
  });

  await t.test('there is no longer any ensureCase escape hatch on the db module', async () => {
    // Structural: if someone reintroduces an auto-create helper, this
    // fails and forces the decision to be made deliberately rather than
    // quietly reopening the hole.
    assert.equal(typeof db.ensureCase, 'undefined', 'db.ensureCase must not exist — case creation belongs to CaseService');
  });

  await t.test('an upload to a real case still works', async () => {
    const result = await VaultService.initiateUpload(
      FIRM_ID, STAFF_ID, makeFile(), { case_id: otherCase.id }, staff
    );
    assert.ok(result.document, 'the upload should have produced a document');
    assert.equal(result.document.case_id, otherCase.id, 'the document must be bound to the named case');
  });

  await t.test('an upload with no case_id at all still works', async () => {
    const result = await VaultService.initiateUpload(FIRM_ID, STAFF_ID, makeFile(), { allow_duplicate: 'true' }, staff);
    assert.ok(result.document);
    assert.equal(result.document.case_id, null);
  });

  await t.test('a CLIENT cannot attach an upload to another client\'s case', async () => {
    // The case genuinely exists, so this is specifically the role-scoping
    // half of the check rather than the existence half. allow_duplicate is
    // set because content-hash dedupe runs earlier in initiateUpload than
    // the case check, and would otherwise be what rejects this call —
    // making the test pass for the wrong reason.
    await assert.rejects(
      () => VaultService.initiateUpload(FIRM_ID, CLIENT_A_ID, makeFile(), { case_id: otherCase.id, allow_duplicate: 'true' }, clientA),
      (err) => err.status === 400 && err.code === 'UNKNOWN_CASE',
      'another client\'s case must be indistinguishable from a nonexistent one'
    );
  });

  await t.test('a CLIENT can still attach an upload to their own case', async () => {
    const result = await VaultService.initiateUpload(
      FIRM_ID, CLIENT_A_ID, makeFile(), { case_id: ownCase.id, allow_duplicate: 'true' }, clientA
    );
    assert.equal(result.document.case_id, ownCase.id);
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
