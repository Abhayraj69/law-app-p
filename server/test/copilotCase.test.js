const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tests for CaseService.resolveAndApply and the identity-resolution
 * helpers it's built on — the real implementation behind the AI
 * Copilot's createOrUpdateCase tool (server/controllers/copilotController.js).
 *
 * Before this, the tool derived a pseudo "case" from documents.case_id
 * and never wrote to the real `cases` table on commit — these tests
 * exist to prove committing a change now actually persists (status,
 * attorney assignment, or a brand-new case), that case identity
 * resolution behaves correctly (id match, name-fallback match, ambiguous
 * name, not-found-with-insufficient-info), and that a genuine concurrent
 * create race resolves to one create + one update rather than a crash or
 * a duplicate.
 *
 * Requires a real database via TEST_DATABASE_URL, same as the other
 * integration suites — skipped (not failed) if it isn't set.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('CaseService.resolveAndApply (AI Copilot createOrUpdateCase backing logic)', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const CaseService = require('../services/caseService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const ATTORNEY_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Copilot Case Test Firm', `copilot-case-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  const attorney = await db.createUser({ id: ATTORNEY_ID, firmId: FIRM_ID, email: `attorney-${ATTORNEY_ID}@example.com`, fullName: 'Jamie Ortiz', role: 'ASSOCIATE', initials: 'JO', passwordHash });
  const actingUser = { id: ATTORNEY_ID, full_name: 'Jamie Ortiz' };

  await t.test('updating an existing case by exact id actually persists to the cases table', async () => {
    const existing = await db.insertCase({ id: `CP-${Date.now()}-A`, firmId: FIRM_ID, caseName: 'Existing Matter', clientName: 'Client A' });

    const result = await CaseService.resolveAndApply(FIRM_ID, actingUser, {
      caseId: existing.id,
      payload: { status: 'urgent', lead_attorney: 'Jamie O.' }
    });

    assert.equal(result.action, 'update');
    assert.equal(result.matchedBy, 'id');
    assert.equal(result.case.status, 'urgent');
    assert.equal(result.case.lead_attorney_id, ATTORNEY_ID);

    // Prove it's a REAL write, not just an in-memory result — read it back
    // via a completely separate query.
    const reread = await db.getCaseByIdForUser(FIRM_ID, existing.id, null);
    assert.equal(reread.status, 'urgent');
    assert.equal(reread.lead_attorney_id, ATTORNEY_ID);
  });

  await t.test('resolves by exact case_name when case_id doesn\'t match anything', async () => {
    const existing = await db.insertCase({ id: `CP-${Date.now()}-B`, firmId: FIRM_ID, caseName: 'Named Matter Unique', clientName: 'Client B' });

    const result = await CaseService.resolveAndApply(FIRM_ID, actingUser, {
      caseId: 'this-id-does-not-exist-anywhere',
      payload: { case_name: 'Named Matter Unique', status: 'pending' }
    });

    assert.equal(result.action, 'update');
    assert.equal(result.matchedBy, 'name');
    assert.equal(result.case.id, existing.id);
    assert.equal(result.case.status, 'pending');
  });

  await t.test('an ambiguous case_name (matches more than one case) is refused, not guessed', async () => {
    const dupeName = `Dupe Matter ${crypto.randomUUID()}`;
    await db.insertCase({ id: `CP-${Date.now()}-C1`, firmId: FIRM_ID, caseName: dupeName, clientName: 'Client C1' });
    await db.insertCase({ id: `CP-${Date.now()}-C2`, firmId: FIRM_ID, caseName: dupeName, clientName: 'Client C2' });

    await assert.rejects(
      () => CaseService.resolveAndApply(FIRM_ID, actingUser, { caseId: 'no-match', payload: { case_name: dupeName, status: 'active' } }),
      (err) => err.status === 409 && err.code === 'AMBIGUOUS_CASE_NAME'
    );
  });

  await t.test('no match and insufficient info to create: refused with 404, nothing is written', async () => {
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM cases WHERE firm_id = $1', [FIRM_ID]);

    await assert.rejects(
      () => CaseService.resolveAndApply(FIRM_ID, actingUser, { caseId: 'brand-new-reference', payload: { status: 'active' } }), // no case_name/client_name
      (err) => err.status === 404 && err.code === 'CASE_NOT_FOUND'
    );

    const after = await pool.query('SELECT COUNT(*)::int AS n FROM cases WHERE firm_id = $1', [FIRM_ID]);
    assert.equal(after.rows[0].n, before.rows[0].n, 'a refused create must not leave a partial row behind');
  });

  await t.test('no match but enough info: creates a REAL new case with a freshly minted id, not the caller\'s reference string', async () => {
    const callerRef = 'ai-generated-placeholder-ref-xyz';

    const result = await CaseService.resolveAndApply(FIRM_ID, actingUser, {
      caseId: callerRef,
      payload: { case_name: 'Brand New Matter', client_name: 'New Client', case_type: 'Commercial Litigation', lead_attorney: 'Jamie O.' }
    });

    assert.equal(result.action, 'create');
    assert.notEqual(result.case.id, callerRef, 'the real case id must never just be the AI/caller\'s arbitrary reference string');
    assert.match(result.case.id, /^LC-\d{4}-\d+$/, 'a created case should get a properly formatted id, same as the human "New Case" flow');
    assert.equal(result.case.client, 'New Client');
    assert.equal(result.case.lead_attorney_id, ATTORNEY_ID);

    const reread = await db.getCaseByIdForUser(FIRM_ID, result.case.id, null);
    assert.ok(reread, 'the created case must be a real, separately-readable row');
  });

  await t.test('updating with an unresolvable attorney name is a hard error, not a silent no-op', async () => {
    const existing = await db.insertCase({ id: `CP-${Date.now()}-D`, firmId: FIRM_ID, caseName: 'Attorney Test Matter', clientName: 'Client D', leadAttorneyId: ATTORNEY_ID });

    await assert.rejects(
      () => CaseService.resolveAndApply(FIRM_ID, actingUser, { caseId: existing.id, payload: { lead_attorney: 'Nobody Real X.' } }),
      (err) => err.status === 400 && err.code === 'ATTORNEY_NOT_FOUND'
    );

    // The case's original attorney must be untouched by the rejected update.
    const reread = await db.getCaseByIdForUser(FIRM_ID, existing.id, null);
    assert.equal(reread.lead_attorney_id, ATTORNEY_ID);
  });

  await t.test('the case-create commit path logs a COPILOT_CREATE_CASE audit entry; update logs COPILOT_UPDATE_CASE', async () => {
    const created = await CaseService.resolveAndApply(FIRM_ID, actingUser, {
      caseId: 'audit-check-ref',
      payload: { case_name: 'Audit Check Matter', client_name: 'Audit Client' }
    });
    const createLog = await pool.query(
      `SELECT * FROM audit_logs WHERE firm_id = $1 AND action = 'COPILOT_CREATE_CASE' AND details->>'case_id' = $2`,
      [FIRM_ID, created.case.id]
    );
    assert.equal(createLog.rowCount, 1);

    await CaseService.resolveAndApply(FIRM_ID, actingUser, {
      caseId: created.case.id,
      payload: { status: 'closed' }
    });
    const updateLog = await pool.query(
      `SELECT * FROM audit_logs WHERE firm_id = $1 AND action = 'COPILOT_UPDATE_CASE' AND details->>'case_id' = $2`,
      [FIRM_ID, created.case.id]
    );
    assert.equal(updateLog.rowCount, 1);
  });

  await t.test('a genuine concurrent create race (same new case, two simultaneous requests) resolves to one create + one update, never a crash or a duplicate', async () => {
    const sharedName = `Race Matter ${crypto.randomUUID()}`;
    const sharedClient = 'Race Client';

    const [a, b] = await Promise.all([
      CaseService.resolveAndApply(FIRM_ID, actingUser, { caseId: 'race-ref-a', payload: { case_name: sharedName, client_name: sharedClient } }),
      CaseService.resolveAndApply(FIRM_ID, actingUser, { caseId: 'race-ref-b', payload: { case_name: sharedName, client_name: sharedClient } })
    ]);

    // Both requests must succeed (neither throws) and both must end up
    // pointing at the SAME real case row — the second one folds into the
    // first via the 23505/re-resolve path in resolveAndApply, rather than
    // creating a second case with the same name.
    assert.equal(a.case.id, b.case.id, 'a concurrent duplicate create must resolve to a single case, not two');

    const matches = await db.findCasesByExactName(FIRM_ID, sharedName);
    assert.equal(matches.length, 1, 'only one case with this name should exist after the race');
  });

  // Teardown — every other table references the firm with ON DELETE
  // CASCADE, so removing it removes the rest.
  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
