const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Limitation Service tests (Phase 6). Covers the CRUD/state-machine layer
 * on top of the already-unit-tested pure engine (limitationWatchEngine.test.js):
 *   - creating a deadline against an unreadable/nonexistent case is refused;
 *   - a deadline's risk_flag reflects real proximity to today, computed at
 *     read time (not stored — see 0029_limitation_watch.sql);
 *   - resolving a deadline makes it read back as risk_flag 'none' even
 *     though the date itself hasn't changed, and can't be resolved twice;
 *   - firm-wide and per-case listing both work, and per-case listing 404s
 *     for a case the caller can't see;
 *   - every create/update/resolve/delete is written to the audit log.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Limitation Service — limitation watch engine CRUD', {
  skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance'
}, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const LimitationService = require('../services/limitationService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const PARALEGAL_ID = crypto.randomUUID();
  const CLIENT_ID = crypto.randomUUID();
  const OTHER_CLIENT_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Limitation Test Firm', `limitation-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const paralegal = await db.createUser({
    id: PARALEGAL_ID, firmId: FIRM_ID, email: `paralegal-${PARALEGAL_ID}@example.com`,
    fullName: 'Test Paralegal', role: 'PARALEGAL', initials: 'TP', passwordHash
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
    id: `LM-A-${Date.now()}`, firmId: FIRM_ID, caseName: 'Limitation Watch Case', clientName: 'Client A',
    clientUserId: CLIENT_ID
  });

  let urgentDeadline, distantDeadline;

  await t.test('creating against a nonexistent case is refused', async () => {
    await assert.rejects(
      () => LimitationService.createDeadline(FIRM_ID, paralegal, {
        case_id: 'NOPE-000', description: 'x', limitation_date: '2026-01-01'
      }),
      (err) => err.status === 404
    );
  });

  await t.test('a deadline due very soon reads back as urgent', async () => {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 3);
    urgentDeadline = await LimitationService.createDeadline(FIRM_ID, paralegal, {
      case_id: caseA.id, description: 'File written statement', limitation_date: soon.toISOString().slice(0, 10)
    });
    assert.equal(urgentDeadline.risk_flag, 'urgent');
    assert.equal(urgentDeadline.status, 'open');
  });

  await t.test('a deadline far in the future reads back as none', async () => {
    const distant = new Date();
    distant.setUTCDate(distant.getUTCDate() + 300);
    distantDeadline = await LimitationService.createDeadline(FIRM_ID, paralegal, {
      case_id: caseA.id, description: 'Distant limitation', limitation_date: distant.toISOString().slice(0, 10)
    });
    assert.equal(distantDeadline.risk_flag, 'none');
  });

  await t.test('resolving a deadline makes it read back as none, and cannot be resolved twice', async () => {
    const resolved = await LimitationService.resolveDeadline(FIRM_ID, paralegal, urgentDeadline.id, 'Filed on time.');
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.risk_flag, 'none', 'resolved always reads back as none, even though the date is still soon');
    assert.equal(resolved.resolution_note, 'Filed on time.');

    await assert.rejects(
      () => LimitationService.resolveDeadline(FIRM_ID, paralegal, urgentDeadline.id),
      (err) => err.status === 400 && err.code === 'ALREADY_RESOLVED'
    );
  });

  await t.test('firm-wide listing filters by status', async () => {
    const open = await LimitationService.listDeadlines(FIRM_ID, { status: 'open' });
    assert.ok(open.some(d => d.id === distantDeadline.id));
    assert.ok(!open.some(d => d.id === urgentDeadline.id));
  });

  await t.test('per-case listing works for the owning client, 404s for another client', async () => {
    const client = await db.getUserByEmail(`client-${CLIENT_ID}@example.com`);
    const forOwner = await LimitationService.listDeadlinesForCase(FIRM_ID, caseA.id, client);
    assert.equal(forOwner.length, 2);

    await assert.rejects(
      () => LimitationService.listDeadlinesForCase(FIRM_ID, caseA.id, otherClient),
      (err) => err.status === 404
    );
  });

  await t.test('updating a deadline\'s date changes its computed risk flag', async () => {
    const farFuture = new Date();
    farFuture.setUTCDate(farFuture.getUTCDate() + 400);
    const updated = await LimitationService.updateDeadline(FIRM_ID, paralegal, distantDeadline.id, {
      limitation_date: farFuture.toISOString().slice(0, 10)
    });
    assert.equal(updated.risk_flag, 'none');
    assert.equal(updated.limitation_date instanceof Date ? updated.limitation_date.toISOString().slice(0, 10) : updated.limitation_date, farFuture.toISOString().slice(0, 10));
  });

  await t.test('deleting a deadline removes it', async () => {
    await LimitationService.deleteDeadline(FIRM_ID, paralegal, distantDeadline.id);
    const remaining = await LimitationService.listDeadlinesForCase(FIRM_ID, caseA.id, paralegal);
    assert.ok(!remaining.some(d => d.id === distantDeadline.id));
  });

  await t.test('every create/resolve/update/delete is written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT action::text AS action FROM audit_logs WHERE firm_id = $1 AND action::text IN
        ('CREATE_LIMITATION_DEADLINE', 'UPDATE_LIMITATION_DEADLINE', 'RESOLVE_LIMITATION_DEADLINE', 'DELETE_LIMITATION_DEADLINE')`,
      [FIRM_ID]
    );
    const actions = new Set(rows.map(r => r.action));
    assert.ok(actions.has('CREATE_LIMITATION_DEADLINE'));
    assert.ok(actions.has('UPDATE_LIMITATION_DEADLINE'));
    assert.ok(actions.has('RESOLVE_LIMITATION_DEADLINE'));
    assert.ok(actions.has('DELETE_LIMITATION_DEADLINE'));
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
