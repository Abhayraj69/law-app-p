const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Route-level authorization test for GET /api/v1/invoices/:id/line-items.
 *
 * This exists because of a real, confirmed vulnerability found by a
 * security review of this session's work: the route was registered with
 * NO requireRole() gate at all. db.getInvoiceById (which
 * TimeEntryService.getLineItems calls) is firm-scoped only, by design —
 * on the assumption that every caller reaching it was already staff-
 * gated by its route (invoice create/update/markPaid all require
 * ASSOCIATE+/PARTNER+). This route broke that assumption silently: ANY
 * authenticated CLIENT could read the itemized line-item breakdown —
 * descriptions of billable work, which can be privileged work-product
 * detail — for ANY invoice at their firm, not just one tied to their own
 * case. Verified live over real HTTP before the fix: a client with no
 * relationship to the invoice's case successfully retrieved another
 * client's line items.
 *
 * UNLIKE every other test in this suite, this one spins up the actual
 * Express app and makes real HTTP requests through it — deliberately.
 * Every other test here (and across the whole server/test/ suite) calls
 * services directly, which is exactly why this bug shipped with 227
 * passing tests and nothing caught it: a missing requireRole() call on a
 * route is invisible to a test that never goes through the route layer
 * at all. This file is the first route-level integration test in the
 * suite; a fuller audit of every route (not just this one) is worth
 * doing separately, and is flagged as its own item rather than attempted
 * here.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('GET /api/v1/invoices/:id/line-items is staff-only over real HTTP', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const authService = require('../services/authService');
  const TimeEntryService = require('../services/timeEntryService');

  await runMigrations();

  // Real Express app, real HTTP, on an ephemeral local port — the whole
  // point of this file. require('../server') only calls start() (DB boot
  // checks, app.listen on the real PORT) when it's the process entry
  // point (require.main === module), which is false here, so this is
  // safe to require directly and just take the exported `app`.
  const app = require('../server');
  const server = app.listen(0);
  const { port } = server.address();
  const BASE = `http://127.0.0.1:${port}`;

  t.after(() => new Promise(resolve => server.close(resolve)));

  const FIRM_ID = crypto.randomUUID();
  const ASSOCIATE_ID = crypto.randomUUID();
  const CLIENT_A_ID = crypto.randomUUID();
  const CLIENT_B_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Line Items Route Firm', `line-items-route-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const associate = await db.createUser({
    id: ASSOCIATE_ID, firmId: FIRM_ID, email: `associate-${ASSOCIATE_ID}@example.com`,
    fullName: 'Route Test Associate', role: 'ASSOCIATE', initials: 'RA', passwordHash
  });
  const clientA = await db.createUser({
    id: CLIENT_A_ID, firmId: FIRM_ID, email: `client-a-${CLIENT_A_ID}@example.com`,
    fullName: 'Client Owner', role: 'CLIENT', initials: 'CO', passwordHash
  });
  const clientB = await db.createUser({
    id: CLIENT_B_ID, firmId: FIRM_ID, email: `client-b-${CLIENT_B_ID}@example.com`,
    fullName: 'Client Outsider', role: 'CLIENT', initials: 'CU', passwordHash
  });

  const ownedCase = await db.insertCase({
    id: `LI-ROUTE-${Date.now()}`, firmId: FIRM_ID, caseName: 'Owned Matter',
    clientName: 'Client Owner', clientUserId: CLIENT_A_ID
  });

  const entry = await TimeEntryService.createTimeEntry(FIRM_ID, associate, {
    case_id: ownedCase.id, minutes: 60, rate_cents: 30000,
    description: 'CONFIDENTIAL work-product memo re settlement strategy'
  });
  const invoice = await TimeEntryService.generateInvoiceFromTimeEntries(FIRM_ID, associate, {
    case_id: ownedCase.id, time_entry_ids: [entry.id]
  });

  const associateToken = authService.issueToken(associate);
  const clientAToken = authService.issueToken(clientA);
  const clientBToken = authService.issueToken(clientB);

  // Auth now travels via the HttpOnly session cookie (T16, see
  // server/utils/sessionCookie.js), not an Authorization header — set the
  // same cookie a browser would have received from Set-Cookie on login.
  const { COOKIE_NAME } = require('../utils/sessionCookie');
  async function getLineItems(token) {
    const res = await fetch(`${BASE}/api/v1/invoices/${invoice.id}/line-items`, {
      headers: { Cookie: `${COOKIE_NAME}=${token}` }
    });
    return { status: res.status, body: await res.json() };
  }

  await t.test('staff (ASSOCIATE+) can read the line items', async () => {
    const { status, body } = await getLineItems(associateToken);
    assert.equal(status, 200);
    assert.equal(body.data.length, 1);
    assert.match(body.data[0].description, /CONFIDENTIAL work-product memo/);
  });

  await t.test('a CLIENT — even one unrelated to this invoice\'s case — is refused', async () => {
    // This is the exact vulnerability: clientB has no relationship to
    // ownedCase or this invoice at all, and the bug let this succeed
    // with 200 and the full confidential description.
    const { status, body } = await getLineItems(clientBToken);
    assert.equal(status, 403, `expected 403, got ${status} with body ${JSON.stringify(body)}`);
    assert.ok(!body.data, 'a 403 must never carry the data it is refusing');
  });

  await t.test('even the CLIENT who owns the underlying case is refused — this endpoint is staff-only', async () => {
    // Deliberate: the fix applied is requireRole('ASSOCIATE'), a blanket
    // staff-only gate, not "any client may see their own invoice's line
    // items" — matching how this endpoint's only real caller (the Edit
    // Invoice modal) was always staff-gated client-side. Documented here
    // so a future change to relax this is a deliberate decision, not a
    // silent regression back to the vulnerability in the other direction.
    const { status } = await getLineItems(clientAToken);
    assert.equal(status, 403);
  });

  await t.test('no token at all is refused with 401, not 403 or 500', async () => {
    const res = await fetch(`${BASE}/api/v1/invoices/${invoice.id}/line-items`);
    assert.equal(res.status, 401);
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
