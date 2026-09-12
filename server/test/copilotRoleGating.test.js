const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tests for the AI Copilot's per-action role gating
 * (server/controllers/copilotController.js).
 *
 * Before this, manageFiles and createOrUpdateCase had no authorization
 * check at all beyond "is this caller logged in" — a PARALEGAL blocked
 * from deleting a file via the Vault UI's delete button (that route
 * requires ASSOCIATE+, see DELETE /api/v1/files/:id in
 * server/routes/api.js) could still delete the same file by asking the
 * Copilot to do it, and any authenticated caller could reassign a case's
 * lead attorney or close it out with no floor whatsoever.
 *
 * Both role checks (manageFiles' delete floor, createOrUpdateCase's
 * lead_attorney/closing-status floor) run and reject BEFORE any target
 * lookup or database write, so these are plain unit tests against the
 * controller functions with a stubbed req/res — no real database
 * round-trip is exercised by the assertions themselves. Requiring the
 * controller module still pulls in server/db -> server/db/pool, which
 * throws at require time without a configured connection string, so this
 * still needs TEST_DATABASE_URL set (same as the other suites here) even
 * though it's never actually queried.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('AI Copilot write-tool role gating', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const { runMigrations } = require('../db/migrate');
  const copilotController = require('../controllers/copilotController');

  // Only the "ASSOCIATE reaches the target lookup" test below actually
  // issues a query (a lookup for a nonexistent document, expected to miss)
  // — every role-check-blocks case short-circuits before touching the
  // database at all. Migrated anyway so that one query doesn't fail with
  // "relation does not exist" against a brand-new test database.
  await runMigrations();

  await t.test('manageFiles delete is blocked for PARALEGAL (below the ASSOCIATE floor DELETE /api/v1/files/:id enforces)', async () => {
    const req = {
      body: { action: 'delete', target_id: 'doc-does-not-matter', target_type: 'file', payload: {}, approved: false },
      user: { id: 'u-paralegal', role: 'PARALEGAL' },
      tenantId: 'firm-does-not-matter'
    };
    const res = fakeRes();
    let nextErr = null;
    await copilotController.manageFiles(req, res, (err) => { nextErr = err; });

    assert.equal(nextErr, null, 'should respond directly, not fall through to the generic error handler');
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.error, /Forbidden: Role 'PARALEGAL' lacks sufficient privilege\. Required: 'ASSOCIATE'\./);
  });

  await t.test('manageFiles delete is allowed for ASSOCIATE to reach the (missing) target — proves the floor, not a false-positive block', async () => {
    const req = {
      body: { action: 'delete', target_id: 'doc-does-not-exist', target_type: 'file', payload: {}, approved: false },
      user: { id: 'u-associate', role: 'ASSOCIATE' },
      tenantId: 'firm-does-not-matter'
    };
    const res = fakeRes();
    let nextErr = null;
    await copilotController.manageFiles(req, res, (err) => { nextErr = err; });

    // Role check passes, so it proceeds to the target lookup and gets a
    // plain 404 (no such document) rather than a 403 — proving the block
    // above was actually the role check, not some unrelated validation
    // error that would 403/400 for anyone.
    assert.equal(nextErr, null);
    assert.equal(res.statusCode, 404);
  });

  await t.test('createOrUpdateCase blocks lead_attorney reassignment below PARTNER', async () => {
    const req = {
      body: { case_id: 'CASE-1', payload: { lead_attorney: 'Jamie O.' }, approved: false },
      user: { id: 'u-associate', role: 'ASSOCIATE' },
      tenantId: 'firm-does-not-matter'
    };
    const res = fakeRes();
    let nextErr = null;
    await copilotController.createOrUpdateCase(req, res, (err) => { nextErr = err; });

    assert.equal(res.statusCode, null, 'the role check throws before the handler ever calls res.json');
    assert.ok(nextErr, 'the forbidden error should be passed to next()');
    assert.equal(nextErr.status, 403);
    assert.equal(nextErr.code, 'INSUFFICIENT_ROLE');
    assert.match(nextErr.message, /Forbidden: Role 'ASSOCIATE' lacks sufficient privilege\. Required: 'PARTNER'\./);
  });

  await t.test('createOrUpdateCase blocks closing a case (status: closed) below PARTNER', async () => {
    const req = {
      body: { case_id: 'CASE-1', payload: { status: 'closed' }, approved: false },
      user: { id: 'u-associate', role: 'ASSOCIATE' },
      tenantId: 'firm-does-not-matter'
    };
    const res = fakeRes();
    let nextErr = null;
    await copilotController.createOrUpdateCase(req, res, (err) => { nextErr = err; });

    assert.ok(nextErr);
    assert.equal(nextErr.status, 403);
    assert.match(nextErr.message, /Required: 'PARTNER'\./);
  });

  await t.test('createOrUpdateCase does NOT tighten a non-terminal status change beyond the existing ASSOCIATE floor', async () => {
    const req = {
      body: { case_id: 'CASE-1', payload: { status: 'urgent' }, approved: false },
      user: { id: 'u-paralegal', role: 'PARALEGAL' },
      tenantId: 'firm-does-not-matter'
    };
    const res = fakeRes();
    let nextErr = null;
    await copilotController.createOrUpdateCase(req, res, (err) => { nextErr = err; });

    // PARALEGAL is below ASSOCIATE, so this should still be blocked —
    // but at the ASSOCIATE floor, not the stricter PARTNER floor.
    assert.ok(nextErr);
    assert.equal(nextErr.status, 403);
    assert.match(nextErr.message, /Required: 'ASSOCIATE'\./);
  });
});
