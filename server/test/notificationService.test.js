const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Notification Service tests (Phase 6).
 *
 * Covers:
 *   - the shipped 'log' provider records a send as 'logged' (never
 *     'sent'), since no real vendor is configured;
 *   - a mocked real provider that actually delivers is recorded as 'sent';
 *   - a provider that throws is recorded as 'failed' with the error, and
 *     does NOT throw out of NotificationService.send itself — the attempt
 *     is always logged regardless of outcome;
 *   - sending to an unknown user, or an invalid channel, is refused before
 *     ever calling the provider;
 *   - listing filters by case_id;
 *   - every send is written to the audit log.
 *
 * The provider is monkey-patched on its own module object, same reasoning
 * courtSync.test.js uses for its own provider selector.
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Notification Service — send through a pluggable provider', {
  skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance'
}, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const notificationProviderSelector = require('../services/notifications/providerSelector');
  const NotificationService = require('../services/notificationService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const PARALEGAL_ID = crypto.randomUUID();
  const RECIPIENT_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Notification Test Firm', `notify-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const paralegal = await db.createUser({
    id: PARALEGAL_ID, firmId: FIRM_ID, email: `paralegal-${PARALEGAL_ID}@example.com`,
    fullName: 'Test Paralegal', role: 'PARALEGAL', initials: 'TP', passwordHash
  });
  const recipient = await db.createUser({
    id: RECIPIENT_ID, firmId: FIRM_ID, email: `recipient-${RECIPIENT_ID}@example.com`,
    fullName: 'Test Recipient', role: 'ASSOCIATE', initials: 'TR', passwordHash
  });

  const caseA = await db.insertCase({
    id: `NT-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Notification Case', clientName: 'Client A'
  });

  const originalGetProvider = notificationProviderSelector.getNotificationProvider;
  t.after(() => {
    notificationProviderSelector.getNotificationProvider = originalGetProvider;
  });

  await t.test('the shipped log provider records the send as logged, not sent', async () => {
    const notification = await NotificationService.send(FIRM_ID, paralegal, {
      user_id: RECIPIENT_ID, channel: 'email', subject: 'Hearing tomorrow', body: 'Reminder: hearing at 10am.'
    });
    assert.equal(notification.status, 'logged');
    assert.equal(notification.provider, 'log');
    assert.equal(notification.recipient_user_id, RECIPIENT_ID);
  });

  await t.test('a mocked real provider that delivers is recorded as sent', async () => {
    notificationProviderSelector.getNotificationProvider = () => ({
      name: 'mock-vendor',
      async send() { return { delivered: true }; }
    });
    const notification = await NotificationService.send(FIRM_ID, paralegal, {
      user_id: RECIPIENT_ID, channel: 'sms', body: 'Reminder text.'
    });
    assert.equal(notification.status, 'sent');
    assert.equal(notification.provider, 'mock-vendor');
  });

  await t.test('a provider that throws is recorded as failed, without send() itself throwing', async () => {
    notificationProviderSelector.getNotificationProvider = () => ({
      name: 'flaky-vendor',
      async send() { throw new Error('Vendor API unreachable.'); }
    });
    const notification = await NotificationService.send(FIRM_ID, paralegal, {
      user_id: RECIPIENT_ID, channel: 'whatsapp', body: 'Reminder.'
    });
    assert.equal(notification.status, 'failed');
    assert.match(notification.error_message, /Vendor API unreachable/);
  });

  await t.test('sending to an unknown user is refused', async () => {
    await assert.rejects(
      () => NotificationService.send(FIRM_ID, paralegal, { user_id: crypto.randomUUID(), channel: 'email', body: 'x' }),
      (err) => err.status === 404
    );
  });

  await t.test('an invalid channel is refused', async () => {
    await assert.rejects(
      () => NotificationService.send(FIRM_ID, paralegal, { user_id: RECIPIENT_ID, channel: 'carrier-pigeon', body: 'x' }),
      (err) => err.status === 400
    );
  });

  await t.test('sending with case context tied to a case the actor cannot see is refused', async () => {
    await assert.rejects(
      () => NotificationService.send(FIRM_ID, paralegal, {
        user_id: RECIPIENT_ID, channel: 'email', body: 'x', case_id: 'NOPE-000'
      }),
      (err) => err.status === 404
    );
  });

  await t.test('listing filters by case_id', async () => {
    notificationProviderSelector.getNotificationProvider = originalGetProvider;
    await NotificationService.send(FIRM_ID, paralegal, {
      user_id: RECIPIENT_ID, channel: 'email', body: 'Case-linked reminder.', case_id: caseA.id
    });

    const filtered = await NotificationService.list(FIRM_ID, { case_id: caseA.id });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].case_id, caseA.id);

    const all = await NotificationService.list(FIRM_ID, {});
    assert.ok(all.length >= 4);
  });

  await t.test('every send is written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM audit_logs WHERE firm_id = $1 AND action::text = 'SEND_NOTIFICATION'`,
      [FIRM_ID]
    );
    assert.ok(rows[0].count >= 4);
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
