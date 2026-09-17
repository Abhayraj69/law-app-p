const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Session revocation tests (db/migrations/0020_session_revocation.sql).
 *
 * Before this, a signed JWT was valid for its entire 12-hour TTL no matter
 * what: "sign out" cleared localStorage in one browser while the token
 * itself kept working anywhere it had been copied, and an admin had no way
 * to cut off a departing employee short of deleting their user row.
 *
 * The tests that matter here are the negative ones — that a revoked token
 * actually STOPS being accepted — so each one takes a token proven to work,
 * revokes it, and asserts the same token is now refused.
 *
 * Requires a real database via TEST_DATABASE_URL, same as
 * server/test/persistence.test.js — skipped (not failed) if it isn't set.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Session revocation: logout and admin force-logout', { skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance' }, async (t) => {
  const crypto = require('node:crypto');
  const jwt = require('jsonwebtoken');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const authService = require('../services/authService');
  const InviteService = require('../services/inviteService');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const OTHER_FIRM_ID = crypto.randomUUID();
  const USER_ID = crypto.randomUUID();
  const ADMIN_ID = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync('irrelevant-not-used-directly', 10);

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, 'Revocation Test Firm', `revoke-${FIRM_ID}.example`
  ]);
  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    OTHER_FIRM_ID, 'Other Revocation Firm', `revoke-other-${OTHER_FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);
  await db.ensureStorageQuota(OTHER_FIRM_ID);

  const user = await db.createUser({
    id: USER_ID, firmId: FIRM_ID, email: `user-${USER_ID}@example.com`,
    fullName: 'Revocation Test User', role: 'ASSOCIATE', initials: 'RU', passwordHash
  });
  const admin = await db.createUser({
    id: ADMIN_ID, firmId: FIRM_ID, email: `admin-${ADMIN_ID}@example.com`,
    fullName: 'Revocation Test Admin', role: 'ADMIN', initials: 'RA', passwordHash
  });

  await t.test('every issued token carries a unique jti', async () => {
    const a = jwt.decode(authService.issueToken(user));
    const b = jwt.decode(authService.issueToken(user));
    assert.ok(a.jti, 'a token must carry a jti so it can be revoked individually');
    assert.notEqual(a.jti, b.jti, 'two tokens for the same user must not share a jti');
  });

  await t.test('a freshly issued token resolves to its user', async () => {
    const token = authService.issueToken(user);
    const resolved = await authService.resolveUserFromToken(token);
    assert.equal(resolved.id, USER_ID);
  });

  await t.test('a logged-out token stops being accepted', async () => {
    const token = authService.issueToken(user);
    // Prove it works first, so the rejection below can only be the revocation.
    assert.equal((await authService.resolveUserFromToken(token)).id, USER_ID);

    await authService.revokeToken(token);

    await assert.rejects(
      () => authService.resolveUserFromToken(token),
      (err) => err.status === 401,
      'a revoked token must be refused, not merely forgotten by the browser'
    );
  });

  await t.test('logging out one session does not affect the user\'s other sessions', async () => {
    const phone = authService.issueToken(user);
    const laptop = authService.issueToken(user);

    await authService.revokeToken(phone);

    await assert.rejects(() => authService.resolveUserFromToken(phone), (err) => err.status === 401);
    assert.equal(
      (await authService.resolveUserFromToken(laptop)).id, USER_ID,
      'signing out on one device must not sign the user out everywhere'
    );
  });

  await t.test('logging out twice is not an error', async () => {
    const token = authService.issueToken(user);
    await authService.revokeToken(token);
    await authService.revokeToken(token); // must not throw on the duplicate jti
    await assert.rejects(() => authService.resolveUserFromToken(token), (err) => err.status === 401);
  });

  await t.test('logging out an already-expired token succeeds quietly', async () => {
    const expired = jwt.sign(
      { sub: USER_ID, firm_id: FIRM_ID, jti: crypto.randomUUID() },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    );
    // Refusing to log someone out because their token already expired
    // would be a pointless failure at exactly the wrong moment.
    const result = await authService.revokeToken(expired);
    assert.equal(result.revoked, false);
    assert.equal(result.reason, 'token_not_valid');
  });

  await t.test('an admin force-logout invalidates every outstanding token at once', async () => {
    const phone = authService.issueToken(user);
    const laptop = authService.issueToken(user);
    assert.equal((await authService.resolveUserFromToken(phone)).id, USER_ID);
    assert.equal((await authService.resolveUserFromToken(laptop)).id, USER_ID);

    await InviteService.revokeUserSessions(FIRM_ID, admin, USER_ID);

    // This is the departing-employee case: BOTH devices, not just one.
    await assert.rejects(() => authService.resolveUserFromToken(phone), (err) => err.status === 401);
    await assert.rejects(() => authService.resolveUserFromToken(laptop), (err) => err.status === 401);
  });

  await t.test('a user can log back in immediately after being force-logged-out', async () => {
    // The regression this guards: `iat` has whole-second resolution, so a
    // sub-second watermark would compare a brand-new token as OLDER than
    // the revocation and lock the user out of their own fresh login. See
    // db.revokeAllSessionsForUser, which second-aligns the watermark.
    await InviteService.revokeUserSessions(FIRM_ID, admin, USER_ID);

    // Wait out the revocation second, the way a real re-login would.
    await new Promise(resolve => setTimeout(resolve, 1100));

    const fresh = authService.issueToken(await db.getUserByIdAndFirm(USER_ID, FIRM_ID));
    const resolved = await authService.resolveUserFromToken(fresh);
    assert.equal(resolved.id, USER_ID, 'a token issued after the revocation must be accepted');
  });

  await t.test('a force-logout affects only the targeted user', async () => {
    const adminToken = authService.issueToken(admin);
    await InviteService.revokeUserSessions(FIRM_ID, admin, USER_ID);
    assert.equal(
      (await authService.resolveUserFromToken(adminToken)).id, ADMIN_ID,
      'revoking one user\'s sessions must not touch anyone else\'s'
    );
  });

  await t.test('an admin cannot force-logout a user at another firm', async () => {
    const outsiderId = crypto.randomUUID();
    await db.createUser({
      id: outsiderId, firmId: OTHER_FIRM_ID, email: `outsider-${outsiderId}@example.com`,
      fullName: 'Outsider', role: 'ASSOCIATE', initials: 'OU', passwordHash
    });

    await assert.rejects(
      () => InviteService.revokeUserSessions(FIRM_ID, admin, outsiderId),
      (err) => err.status === 404,
      'a valid user id from another firm must not be actionable'
    );

    const outsider = await db.getUserByIdAndFirm(outsiderId, OTHER_FIRM_ID);
    const outsiderToken = authService.issueToken(outsider);
    assert.equal(
      (await authService.resolveUserFromToken(outsiderToken)).id, outsiderId,
      'the other firm\'s user must still be signed in'
    );
  });

  await t.test('a token whose jti was never revoked is unaffected by the revocation table', async () => {
    const other = await db.getUserByIdAndFirm(ADMIN_ID, FIRM_ID);
    const token = authService.issueToken(other);
    assert.equal(await db.isTokenRevoked(jwt.decode(token).jti), false);
    assert.equal((await authService.resolveUserFromToken(token)).id, ADMIN_ID);
  });

  await t.test('a legacy token with no jti is handled by revoking all sessions', async () => {
    // Tokens issued before migration 0020 carry no jti, so they cannot be
    // revoked individually. Falling back to the all-sessions watermark is
    // strictly safer than silently doing nothing.
    const legacy = jwt.sign({ sub: ADMIN_ID, firm_id: FIRM_ID }, process.env.JWT_SECRET, { expiresIn: '12h' });
    const result = await authService.revokeToken(legacy);
    assert.equal(result.reason, 'legacy_token_all_sessions_revoked');
    await assert.rejects(() => authService.resolveUserFromToken(legacy), (err) => err.status === 401);
  });

  await t.test('expired revocation rows are swept, and sweeping does not un-revoke a live token', async () => {
    const live = authService.issueToken(user);
    await authService.revokeToken(live);

    // A revocation row for a token that has already expired is dead
    // weight — jwt.verify rejects the token on its own signature/exp
    // check, so the row buys nothing.
    const staleJti = crypto.randomUUID();
    await db.revokeToken({ jti: staleJti, userId: USER_ID, expiresAt: new Date(Date.now() - 60_000) });
    assert.equal(await db.isTokenRevoked(staleJti), true);

    const removed = await db.cleanupExpiredRevocations();
    assert.ok(removed >= 1, 'the expired revocation row should have been swept');
    assert.equal(await db.isTokenRevoked(staleJti), false);

    // The still-live revocation must survive the sweep, or logout would
    // silently stop working after any cleanup.
    await assert.rejects(() => authService.resolveUserFromToken(live), (err) => err.status === 401);
  });

  await pool.query('DELETE FROM firms WHERE id = ANY($1)', [[FIRM_ID, OTHER_FIRM_ID]]);
});
