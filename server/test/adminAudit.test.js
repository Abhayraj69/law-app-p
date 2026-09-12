const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Admin audit-log viewer + storage-quota admin tests.
 *
 * The audit_logs table and storage_quotas row were both already written
 * to (logAuditAction middleware / db.insertAuditLog, and the storage
 * quota trigger on document insert/delete) but nothing read either back
 * for an admin to look at. These tests prove: pagination and filtering
 * (by user, action, date) on the audit log actually narrow the result
 * set correctly against real inserted rows, and the storage quota view
 * reflects real usage and can be updated (with its own write logged
 * back into the same audit trail, and a floor that rejects an
 * unreasonably small limit).
 *
 * Requires a real database via TEST_DATABASE_URL, same as the other
 * integration tests — skipped (not failed) if it isn't set.
 * Run with: TEST_DATABASE_URL=postgres://... npm test
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Admin audit log + storage quota', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const AuditLogService = require('../services/auditLogService');
  const StorageQuotaService = require('../services/storageQuotaService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const ADMIN_ID = crypto.randomUUID();
  const ASSOCIATE_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Audit Test Firm', `audit-test-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  const admin = await db.createUser({ id: ADMIN_ID, firmId: FIRM_ID, email: `admin-${ADMIN_ID}@example.com`, fullName: 'Test Admin', role: 'ADMIN', initials: 'TA', passwordHash });
  const associate = await db.createUser({ id: ASSOCIATE_ID, firmId: FIRM_ID, email: `assoc-${ASSOCIATE_ID}@example.com`, fullName: 'Test Associate', role: 'ASSOCIATE', initials: 'TS', passwordHash });

  await t.test('listAuditLogs paginates and filters by user/action/date', async () => {
    // Seed a known, deterministic set of audit rows for this firm: 3 by
    // the admin (2x CREATE_CASE, 1x ARCHIVE_CASE), 2 by the associate
    // (CREATE_CASE), all "today", plus one CREATE_CASE row backdated 10
    // days so the date filter has something real to exclude.
    await db.insertAuditLog({ firmId: FIRM_ID, userId: ADMIN_ID, action: 'CREATE_CASE', details: { case_id: 'LC-TEST-001' } });
    await db.insertAuditLog({ firmId: FIRM_ID, userId: ADMIN_ID, action: 'CREATE_CASE', details: { case_id: 'LC-TEST-002' } });
    await db.insertAuditLog({ firmId: FIRM_ID, userId: ADMIN_ID, action: 'ARCHIVE_CASE', details: { case_id: 'LC-TEST-001' } });
    await db.insertAuditLog({ firmId: FIRM_ID, userId: ASSOCIATE_ID, action: 'CREATE_CASE', details: { case_id: 'LC-TEST-003' } });
    await db.insertAuditLog({ firmId: FIRM_ID, userId: ASSOCIATE_ID, action: 'CREATE_CASE', details: { case_id: 'LC-TEST-004' } });
    await pool.query(
      `INSERT INTO audit_logs (firm_id, user_id, action, details, created_at)
       VALUES ($1, $2, 'CREATE_CASE', $3, CURRENT_TIMESTAMP - INTERVAL '10 days')`,
      [FIRM_ID, ADMIN_ID, JSON.stringify({ case_id: 'LC-TEST-OLD' })]
    );

    const all = await AuditLogService.listAuditLogs(FIRM_ID, {});
    assert.equal(all.total, 6, 'every row for this firm should be counted, including the backdated one');
    assert.equal(all.logs.length, 6, 'default page size (20) should return all 6 rows on page 1');
    assert.ok(
      all.logs.every((log, i) => i === 0 || new Date(log.created_at) <= new Date(all.logs[i - 1].created_at)),
      'results must be ordered newest first'
    );

    const paged = await AuditLogService.listAuditLogs(FIRM_ID, { page: '1', page_size: '2' });
    assert.equal(paged.logs.length, 2, 'page_size should cap the returned rows');
    assert.equal(paged.total, 6, 'total should reflect the full filtered count, not just this page');
    const page2 = await AuditLogService.listAuditLogs(FIRM_ID, { page: '2', page_size: '2' });
    assert.notEqual(paged.logs[0].id, page2.logs[0].id, 'page 2 must return different rows than page 1');

    const byUser = await AuditLogService.listAuditLogs(FIRM_ID, { user_id: ASSOCIATE_ID });
    assert.equal(byUser.total, 2, 'filtering by user_id should only count that user\'s rows');
    assert.ok(byUser.logs.every(l => l.user_name === 'Test Associate'));

    const byAction = await AuditLogService.listAuditLogs(FIRM_ID, { action: 'ARCHIVE_CASE' });
    assert.equal(byAction.total, 1, 'filtering by action should exclude every other action type');

    const today = new Date().toISOString().slice(0, 10);
    const byDate = await AuditLogService.listAuditLogs(FIRM_ID, { date_from: today, date_to: today });
    assert.equal(byDate.total, 5, 'the backdated row from 10 days ago must be excluded by a today-only date range');

    await assert.rejects(
      () => AuditLogService.listAuditLogs(FIRM_ID, { date_from: 'not-a-date' }),
      (err) => err.status === 400,
      'an unparseable date filter should be rejected with 400, not silently ignored or crash as a 500'
    );

    // Rows from a DIFFERENT firm must never leak into this firm's count.
    const OTHER_FIRM_ID = crypto.randomUUID();
    await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
      OTHER_FIRM_ID, 'Other Firm', `other-firm-${OTHER_FIRM_ID}.example`
    ]);
    await db.insertAuditLog({ firmId: OTHER_FIRM_ID, userId: null, action: 'CREATE_CASE', details: {} });
    const stillSix = await AuditLogService.listAuditLogs(FIRM_ID, {});
    assert.equal(stillSix.total, 6, 'another firm\'s audit rows must not be counted for this firm');
  });

  await t.test('storage quota view reflects real usage and can be updated by an admin', async () => {
    const before = await StorageQuotaService.getQuota(FIRM_ID);
    assert.equal(before.storage_used_bytes, 0, 'a freshly-ensured quota should start at 0 used');
    assert.equal(before.storage_limit_bytes, 107374182400, 'ensureStorageQuota\'s 100GB default should be reflected');

    const NEW_LIMIT = 5 * 1024 * 1024 * 1024; // 5GB
    const updated = await StorageQuotaService.updateQuota(FIRM_ID, admin, NEW_LIMIT);
    assert.equal(updated.storage_limit_bytes, NEW_LIMIT);

    const reread = await StorageQuotaService.getQuota(FIRM_ID);
    assert.equal(reread.storage_limit_bytes, NEW_LIMIT, 'the new limit must actually persist, not just echo back in the response');

    // The update itself must show up in the audit trail it feeds.
    const logs = await AuditLogService.listAuditLogs(FIRM_ID, { action: 'UPDATE_STORAGE_QUOTA' });
    assert.equal(logs.total, 1, 'updating the quota should write exactly one UPDATE_STORAGE_QUOTA audit row');
    assert.equal(logs.logs[0].details.storage_limit_bytes, NEW_LIMIT);

    await assert.rejects(
      () => StorageQuotaService.updateQuota(FIRM_ID, admin, 100),
      (err) => err.status === 400,
      'a limit below the 1GB floor must be rejected, not silently clamped or accepted'
    );
    await assert.rejects(
      () => StorageQuotaService.updateQuota(FIRM_ID, admin, NEW_LIMIT + 0.5),
      (err) => err.status === 400,
      'a non-integer byte count must be rejected'
    );
  });
});
