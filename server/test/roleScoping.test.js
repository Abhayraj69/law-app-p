const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Role-scoping / broken-access-control tests for the Active Cases and
 * Client Communications APIs.
 *
 * These exist because the acceptance criterion for wiring those pages up
 * was explicit: a CLIENT-role user must not be able to read another
 * client's cases or messages, and 'note'-type conversation messages are
 * staff-only. It is not enough to prove the happy path (a client sees
 * their own data) — every test here actively ATTEMPTS the forbidden read
 * and asserts it is refused, the same way server/test/auth.test.js proves
 * the old x-tenant-id/x-user-id impersonation bug stays fixed.
 *
 * Requires a real database via TEST_DATABASE_URL, same as
 * server/test/persistence.test.js — skipped (not failed) if it isn't set.
 * Run with: TEST_DATABASE_URL=postgres://... npm test
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Role scoping: cases and conversations', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const CaseService = require('../services/caseService');
  const CommunicationsService = require('../services/communicationsService');

  await runMigrations();

  // Fresh ids per run so repeated/parallel runs never collide; everything
  // is torn down at the end via the firm's ON DELETE CASCADE.
  const FIRM_ID = crypto.randomUUID();
  const STAFF_ID = crypto.randomUUID();
  const CLIENT_A_ID = crypto.randomUUID();
  const CLIENT_B_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Role Scoping Test Firm', `role-scoping-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const staff = await db.createUser({ id: STAFF_ID, firmId: FIRM_ID, email: `staff-${STAFF_ID}@example.com`, fullName: 'Test Staff', role: 'ASSOCIATE', initials: 'TS', passwordHash });
  const clientA = await db.createUser({ id: CLIENT_A_ID, firmId: FIRM_ID, email: `client-a-${CLIENT_A_ID}@example.com`, fullName: 'Client Alpha', role: 'CLIENT', initials: 'CA', passwordHash });
  const clientB = await db.createUser({ id: CLIENT_B_ID, firmId: FIRM_ID, email: `client-b-${CLIENT_B_ID}@example.com`, fullName: 'Client Beta', role: 'CLIENT', initials: 'CB', passwordHash });

  const caseA = await db.insertCase({ id: `RS-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Client A Matter', clientName: 'Client Alpha', clientUserId: CLIENT_A_ID });
  const caseB = await db.insertCase({ id: `RS-B-${Date.now()}`, firmId: FIRM_ID, caseName: 'Client B Matter', clientName: 'Client Beta', clientUserId: CLIENT_B_ID });

  const convA = await db.insertConversation({ firmId: FIRM_ID, caseId: caseA.id, clientUserId: CLIENT_A_ID, clientName: 'Client Alpha' });
  const convB = await db.insertConversation({ firmId: FIRM_ID, caseId: caseB.id, clientUserId: CLIENT_B_ID, clientName: 'Client Beta' });

  await db.insertConversationMessage({ conversationId: convA.id, sender: 'client', senderUserId: CLIENT_A_ID, body: 'A client message' });
  await db.insertConversationMessage({ conversationId: convA.id, sender: 'staff', senderUserId: STAFF_ID, body: 'A staff reply' });
  await db.insertConversationMessage({ conversationId: convA.id, sender: 'note', senderUserId: STAFF_ID, body: 'An internal-only staff note about client A' });

  await t.test('a CLIENT only sees their own case in the case list, never the other client\'s', async () => {
    const cases = await CaseService.listCases(FIRM_ID, clientA);
    const ids = cases.map(c => c.id);
    assert.ok(ids.includes(caseA.id), 'own case should be listed');
    assert.ok(!ids.includes(caseB.id), 'the OTHER client\'s case must not appear in the list');
  });

  await t.test('a CLIENT cannot fetch another client\'s case directly by id', async () => {
    await assert.rejects(
      () => CaseService.getCase(FIRM_ID, caseB.id, clientA),
      (err) => err.status === 404,
      'fetching another client\'s case by known id must be refused (404), not returned'
    );
    // Sanity check: the same client CAN fetch their own case by id.
    const own = await CaseService.getCase(FIRM_ID, caseA.id, clientA);
    assert.equal(own.id, caseA.id);
  });

  await t.test('a CLIENT only sees their own conversation in the conversation list', async () => {
    const conversations = await CommunicationsService.listConversations(FIRM_ID, clientA);
    const ids = conversations.map(c => c.id);
    assert.ok(ids.includes(convA.id), 'own conversation should be listed');
    assert.ok(!ids.includes(convB.id), 'the OTHER client\'s conversation must not appear in the list');
  });

  await t.test('a CLIENT cannot fetch another client\'s conversation directly by id', async () => {
    await assert.rejects(
      () => CommunicationsService.getConversation(FIRM_ID, convB.id, clientA),
      (err) => err.status === 404,
      'fetching another client\'s conversation by known id must be refused (404), not returned'
    );
  });

  await t.test('a CLIENT cannot post a message into another client\'s conversation', async () => {
    await assert.rejects(
      () => CommunicationsService.postMessage(FIRM_ID, clientA, convB.id, { text: 'sneaking in' }),
      (err) => err.status === 404,
      'posting into another client\'s conversation must be refused (404)'
    );
  });

  await t.test('"note" messages are stripped from a CLIENT\'s view of their OWN conversation', async () => {
    const conv = await CommunicationsService.getConversation(FIRM_ID, convA.id, clientA);
    assert.equal(conv.messages.length, 2, 'only the client + staff messages should be visible, not the note');
    assert.ok(conv.messages.every(m => !m.isNote), 'no message returned to a CLIENT may be a note');
    assert.ok(conv.messages.every(m => !m.text.includes('internal-only staff note')), 'the note body must never leak into the response');
  });

  await t.test('staff DOES see the note when reading the same conversation', async () => {
    const conv = await CommunicationsService.getConversation(FIRM_ID, convA.id, staff);
    assert.equal(conv.messages.length, 3, 'staff should see all three messages, including the note');
    assert.ok(conv.messages.some(m => m.isNote), 'staff view must include the note');
  });

  await t.test('a CLIENT posting a message can never create a note, even if they ask for one', async () => {
    const posted = await CommunicationsService.postMessage(FIRM_ID, clientA, convA.id, { text: 'trying to sneak a note in', isNote: true });
    assert.equal(posted.sender, 'client', 'a CLIENT-authored message must be stored as sender=client, never sender=note');
    assert.equal(posted.isNote, false);
  });

  await t.test('a CLIENT\'s dashboard counts never include another client\'s cases/messages', async () => {
    const DashboardService = require('../services/dashboardService');
    const summary = await DashboardService.getSummary(FIRM_ID, clientA);
    // Client A has exactly 1 active case (their own); Client B's case must
    // not be counted even though it belongs to the same firm.
    assert.equal(summary.kpis.active_cases, 1);
  });

  // Teardown — every other table references the firm with ON DELETE
  // CASCADE, so removing it removes the rest.
  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
