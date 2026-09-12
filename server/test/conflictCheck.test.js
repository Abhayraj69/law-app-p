const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Tests for ConflictCheckService and its wiring into CaseService.createCase
 * (see server/services/conflictCheckService.js). Covers:
 *   - normalizeName's corporate-suffix stripping
 *   - cross-field matching (a new client hitting a past OPPOSING party, not
 *     just a past client — the actually-useful conflict signal)
 *   - createCase surfacing a 409 with structured matches on a hit, refusing
 *     to write anything
 *   - createCase proceeding once conflictOverride + a reason are supplied,
 *     and logging CONFLICT_CHECK_OVERRIDE
 *   - a clear case logging CONFLICT_CHECK_CLEAR and writing normally
 *
 * Requires a real database via TEST_DATABASE_URL, same as the other
 * integration suites — skipped (not failed) if it isn't set.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('ConflictCheckService.normalizeName', () => {
  const ConflictCheckService = require('../services/conflictCheckService');
  assert.equal(ConflictCheckService.normalizeName('Meridian Corp.'), 'meridian');
  assert.equal(ConflictCheckService.normalizeName('Meridian Corporation'), 'meridian');
  assert.equal(ConflictCheckService.normalizeName('  James   Anderson '), 'james anderson');
  assert.equal(ConflictCheckService.normalizeName(''), '');
  assert.equal(ConflictCheckService.normalizeName(null), '');
});

test('Conflict-of-interest check', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const CaseService = require('../services/caseService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const USER_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Conflict Check Test Firm', `conflict-check-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  const actingUser = await db.createUser({ id: USER_ID, firmId: FIRM_ID, email: `attorney-${USER_ID}@example.com`, fullName: 'Test Attorney', role: 'ASSOCIATE', initials: 'TA', passwordHash });

  // A prior, unrelated case where "Meridian Corp." was the OPPOSING party —
  // the interesting case is a new CLIENT matching a past OPPOSING party,
  // not just client-to-client.
  await db.insertCase({
    id: `CC-${Date.now()}-A`, firmId: FIRM_ID,
    caseName: 'Anderson v. Meridian', clientName: 'James Anderson',
    opposingParty: 'Meridian Corp.'
  });

  // The dev seed data already occupies LC-2026-001..005 globally (cases.id
  // is a plain, non-firm-scoped primary key) — priming this firm's own
  // counter past that range keeps CaseService.createCase's auto-generated
  // ids below from colliding with the seed firm's rows.
  await db.insertCase({
    id: 'LC-2026-900001', firmId: FIRM_ID,
    caseName: 'zz-conflict-test-primer', clientName: 'zz-conflict-test-primer'
  });

  await t.test('a new case whose client matches a past opposing party is flagged, not silently blocked', async () => {
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM cases WHERE firm_id = $1', [FIRM_ID]);

    await assert.rejects(
      () => CaseService.createCase(FIRM_ID, actingUser, {
        title: 'Meridian Expansion Matter',
        client: 'Meridian Corporation', // normalizes the same as "Meridian Corp."
        opposingParty: 'Some Other Party'
      }),
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, 'CONFLICT_CHECK_HIT');
        assert.equal(err.conflicts.length, 1);
        assert.equal(err.conflicts[0].existingField, 'opposing_party');
        assert.equal(err.conflicts[0].newField, 'client');
        return true;
      }
    );

    const after = await pool.query('SELECT COUNT(*)::int AS n FROM cases WHERE firm_id = $1', [FIRM_ID]);
    assert.equal(after.rows[0].n, before.rows[0].n, 'a refused create must not leave a partial row behind');

    const hitLog = await pool.query(
      `SELECT * FROM audit_logs WHERE firm_id = $1 AND action = 'CONFLICT_CHECK_HIT'`,
      [FIRM_ID]
    );
    assert.equal(hitLog.rowCount, 1);
  });

  await t.test('resubmitting with an override and a reason proceeds and logs CONFLICT_CHECK_OVERRIDE', async () => {
    const created = await CaseService.createCase(FIRM_ID, actingUser, {
      title: 'Meridian Expansion Matter',
      client: 'Meridian Corporation',
      opposingParty: 'Some Other Party',
      conflictOverride: true,
      conflictOverrideReason: 'Reviewed — different Meridian entity, cleared by managing partner.'
    });

    assert.equal(created.client, 'Meridian Corporation');

    const overrideLog = await pool.query(
      `SELECT * FROM audit_logs WHERE firm_id = $1 AND action = 'CONFLICT_CHECK_OVERRIDE' AND details->>'case_id' = $2`,
      [FIRM_ID, created.id]
    );
    assert.equal(overrideLog.rowCount, 1);
    assert.equal(overrideLog.rows[0].details.overrideReason, 'Reviewed — different Meridian entity, cleared by managing partner.');
  });

  await t.test('an override without a reason is refused', async () => {
    await assert.rejects(
      () => CaseService.createCase(FIRM_ID, actingUser, {
        title: 'Another Meridian Matter',
        client: 'Meridian Corp.',
        conflictOverride: true
      }),
      (err) => err.status === 400
    );
  });

  await t.test('a case with no matching parties clears and logs CONFLICT_CHECK_CLEAR', async () => {
    const created = await CaseService.createCase(FIRM_ID, actingUser, {
      title: 'Totally Unrelated Matter',
      client: 'Someone Else Entirely',
      relatedEntities: ['A Related Entity Inc.']
    });

    assert.deepEqual(created.relatedEntities, ['A Related Entity Inc.']);

    const clearLog = await pool.query(
      `SELECT * FROM audit_logs WHERE firm_id = $1 AND action = 'CONFLICT_CHECK_CLEAR' AND details->>'case_id' = $2`,
      [FIRM_ID, created.id]
    );
    assert.equal(clearLog.rowCount, 1);
  });

  await t.test('a related entity on an existing case is matched against a new case\'s opposing party', async () => {
    await assert.rejects(
      () => CaseService.createCase(FIRM_ID, actingUser, {
        title: 'Yet Another Matter',
        client: 'Fresh Client Name',
        opposingParty: 'A Related Entity Inc.' // matches the related_entities entry seeded above
      }),
      (err) => err.status === 409 && err.conflicts[0].existingField === 'related_entities'
    );
  });

  // Teardown — every other table references the firm with ON DELETE
  // CASCADE, so removing it removes the rest.
  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
