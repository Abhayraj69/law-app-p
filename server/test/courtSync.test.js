const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Court Sync tests (Phase 5 — Karnataka HC + eCourts).
 *
 * Covers:
 *   - a case must be linked (cnr_number set) before it can be synced;
 *   - a successful sync persists a normalized synced state and writes a
 *     'success' court_sync_logs row;
 *   - the shipped 'manual' provider always refuses (no vendor configured
 *     yet) and a failed sync writes an 'error' row + marks the case
 *     'error', with a 503 surfaced to the caller for that specific reason;
 *   - a manual override puts the case into 'manual_override' and a
 *     subsequent syncCase() is refused (MANUAL_OVERRIDE_ACTIVE) rather than
 *     silently clobbering the correction;
 *   - clearing the override hands the case back to the normal flow and a
 *     sync can run again;
 *   - the cause-list watchlist surfaces a case flagged for it, with
 *     on_upcoming_cause_list computed from today's date, not stored;
 *   - case ownership scoping: a different client gets 404;
 *   - every link/sync/override/clear/watch action is written to the audit log.
 *
 * The court-data provider is monkey-patched on its own module object (see
 * courtSyncService.js's comment on why it's required that way), same
 * reasoning matterAnalysis.test.js/draftService.test.js use for aiProvider.
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Court Sync Service — court data sync', {
  skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance'
}, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const courtSyncProviderSelector = require('../services/courtSync/providerSelector');
  const CourtSyncService = require('../services/courtSyncService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const ASSOCIATE_ID = crypto.randomUUID();
  const CLIENT_ID = crypto.randomUUID();
  const OTHER_CLIENT_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Court Sync Test Firm', `court-sync-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const associate = await db.createUser({
    id: ASSOCIATE_ID, firmId: FIRM_ID, email: `associate-${ASSOCIATE_ID}@example.com`,
    fullName: 'Test Associate', role: 'ASSOCIATE', initials: 'TA', passwordHash
  });
  await db.createUser({
    id: CLIENT_ID, firmId: FIRM_ID, email: `client-${CLIENT_ID}@example.com`,
    fullName: 'Test Client', role: 'CLIENT', initials: 'TC', passwordHash
  });
  const otherClient = await db.createUser({
    id: OTHER_CLIENT_ID, firmId: FIRM_ID, email: `other-client-${OTHER_CLIENT_ID}@example.com`,
    fullName: 'Other Client', role: 'CLIENT', initials: 'OC', passwordHash
  });

  const caseA = await db.insertCase({
    id: `CS-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Court Sync Case', clientName: 'Client A',
    clientUserId: CLIENT_ID
  });

  const originalGetProvider = courtSyncProviderSelector.getCourtSyncProvider;
  t.after(() => {
    courtSyncProviderSelector.getCourtSyncProvider = originalGetProvider;
  });

  await t.test('syncing an unlinked case is refused', async () => {
    await assert.rejects(
      () => CourtSyncService.syncCase(FIRM_ID, associate, caseA.id),
      (err) => err.status === 400 && err.code === 'NOT_LINKED'
    );
  });

  await t.test('linking sets the CNR number and court name', async () => {
    const state = await CourtSyncService.linkCase(FIRM_ID, associate, caseA.id, {
      cnr_number: 'KABC010012342026', court_name: 'Karnataka High Court'
    });
    assert.equal(state.cnr_number, 'KABC010012342026');
    assert.equal(state.court_sync_status, 'unlinked', 'linking alone does not mark it synced');
  });

  await t.test('the shipped manual provider always refuses — sync fails 503 and logs an error row', async () => {
    await assert.rejects(
      () => CourtSyncService.syncCase(FIRM_ID, associate, caseA.id),
      (err) => err.status === 503 && err.code === 'COURT_SYNC_NOT_CONFIGURED'
    );

    const logs = await CourtSyncService.listSyncLogs(FIRM_ID, caseA.id, associate);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'error');

    const state = await CourtSyncService.getCourtSyncState(FIRM_ID, caseA.id, associate);
    assert.equal(state.court_sync_status, 'error');
  });

  await t.test('a successful sync (mocked provider) persists a normalized state and logs success', async () => {
    courtSyncProviderSelector.getCourtSyncProvider = () => ({
      name: 'mock-vendor',
      async fetchCaseStatus() {
        return { stage: 'Arguments', nextHearingDate: '2026-04-01', lastOrder: 'Adjourned to 2026-04-01', causeListDate: null };
      }
    });

    const state = await CourtSyncService.syncCase(FIRM_ID, associate, caseA.id);
    assert.equal(state.court_sync_status, 'synced');
    assert.equal(state.court_synced_state.stage, 'Arguments');
    assert.equal(state.court_synced_state.next_hearing_date, '2026-04-01');

    const logs = await CourtSyncService.listSyncLogs(FIRM_ID, caseA.id, associate);
    assert.equal(logs.length, 2, 'the earlier failed attempt is kept, not overwritten');
    assert.equal(logs[0].status, 'success', 'newest first');
  });

  await t.test('a manual override blocks a subsequent sync until cleared', async () => {
    const overridden = await CourtSyncService.overrideSync(FIRM_ID, associate, caseA.id, {
      synced_state: { stage: 'Corrected stage', cause_list_date: null },
      note: 'Vendor feed was stale, corrected from the court\'s own order sheet.'
    });
    assert.equal(overridden.court_sync_status, 'manual_override');
    assert.equal(overridden.court_synced_state.stage, 'Corrected stage');

    courtSyncProviderSelector.getCourtSyncProvider = () => ({
      name: 'mock-vendor',
      async fetchCaseStatus() { return { stage: 'Should not apply' }; }
    });

    await assert.rejects(
      () => CourtSyncService.syncCase(FIRM_ID, associate, caseA.id),
      (err) => err.status === 409 && err.code === 'MANUAL_OVERRIDE_ACTIVE'
    );

    const cleared = await CourtSyncService.clearOverride(FIRM_ID, associate, caseA.id);
    assert.equal(cleared.court_sync_status, 'synced');
    assert.equal(cleared.court_synced_state.stage, 'Corrected stage', 'the correction stays as the accepted baseline');

    const state = await CourtSyncService.syncCase(FIRM_ID, associate, caseA.id);
    assert.equal(state.court_synced_state.stage, 'Should not apply', 'a normal sync can run again after clearing');
  });

  await t.test('clearing an override that is not active is refused', async () => {
    await assert.rejects(
      () => CourtSyncService.clearOverride(FIRM_ID, associate, caseA.id),
      (err) => err.status === 409 && err.code === 'WRONG_STATE'
    );
  });

  await t.test('cause-list watchlist surfaces a flagged case with a computed alert', async () => {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 3);
    courtSyncProviderSelector.getCourtSyncProvider = () => ({
      name: 'mock-vendor',
      async fetchCaseStatus() { return { causeListDate: soon.toISOString().slice(0, 10) }; }
    });
    await CourtSyncService.syncCase(FIRM_ID, associate, caseA.id);
    await CourtSyncService.setCauseListWatch(FIRM_ID, associate, caseA.id, true);

    const watchlist = await CourtSyncService.listCauseListWatch(FIRM_ID);
    assert.equal(watchlist.length, 1);
    assert.equal(watchlist[0].case_id, caseA.id);
    assert.equal(watchlist[0].on_upcoming_cause_list, true);

    await CourtSyncService.setCauseListWatch(FIRM_ID, associate, caseA.id, false);
    const cleared = await CourtSyncService.listCauseListWatch(FIRM_ID);
    assert.equal(cleared.length, 0);
  });

  await t.test('a different client gets a 404, not this matter\'s court sync state', async () => {
    await assert.rejects(
      () => CourtSyncService.getCourtSyncState(FIRM_ID, caseA.id, otherClient),
      (err) => err.status === 404
    );
  });

  await t.test('every link/sync/override/clear/watch action is written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT action::text AS action FROM audit_logs WHERE firm_id = $1 AND action::text IN
        ('LINK_COURT_CASE', 'SYNC_COURT_CASE', 'OVERRIDE_COURT_SYNC', 'CLEAR_COURT_SYNC_OVERRIDE', 'UPDATE_CAUSE_LIST_WATCH')`,
      [FIRM_ID]
    );
    const actions = new Set(rows.map(r => r.action));
    assert.ok(actions.has('LINK_COURT_CASE'));
    assert.ok(actions.has('SYNC_COURT_CASE'));
    assert.ok(actions.has('OVERRIDE_COURT_SYNC'));
    assert.ok(actions.has('CLEAR_COURT_SYNC_OVERRIDE'));
    assert.ok(actions.has('UPDATE_CAUSE_LIST_WATCH'));
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
