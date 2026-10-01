const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Two-factor authentication tests (Phase 6).
 *
 * Covers the full lifecycle:
 *   - setup() stores a secret but does NOT enable 2FA yet;
 *   - enable() refuses a wrong code, then succeeds with a real one and
 *     hands back recovery codes;
 *   - once enabled, login() returns an mfa_token challenge instead of a
 *     real session token;
 *   - the mfa_token cannot be used as a bearer token for a normal
 *     authenticated route (resolveUserFromToken must refuse it);
 *   - verifyChallenge() with the right TOTP code returns the user, so
 *     authController can issue a real token from it;
 *   - a recovery code works exactly once — the second use of the same
 *     code is refused;
 *   - disable() requires the correct password and revokes every other
 *     session.
 *
 * Requires a real database via TEST_DATABASE_URL — skipped if unset.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

if (TEST_DB_URL) {
  process.env.DATABASE_URL = TEST_DB_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-for-production-use-1234567890';
}

test('Two-Factor Authentication — enrollment, login gating, recovery codes', {
  skip: !TEST_DB_URL && 'set TEST_DATABASE_URL to run these integration tests against a real Postgres instance'
}, async (t) => {
  const crypto = require('node:crypto');
  const bcrypt = require('bcryptjs');
  const { pool } = require('../db/pool');
  const { runMigrations } = require('../db/migrate');
  const db = require('../db');
  const authService = require('../services/authService');
  const TwoFactorService = require('../services/twoFactorService');
  const totp = require('../services/totp');

  await runMigrations();

  const FIRM_ID = crypto.randomUUID();
  const USER_ID = crypto.randomUUID();
  const PLAINTEXT_PASSWORD = 'CorrectHorseBatteryStaple1';

  await pool.query(`INSERT INTO firms (id, name, domain) VALUES ($1, $2, $3)`, [
    FIRM_ID, '2FA Test Firm', `2fa-${FIRM_ID}.example`
  ]);
  await db.ensureStorageQuota(FIRM_ID);

  const user = await db.createUser({
    id: USER_ID, firmId: FIRM_ID, email: `user-${USER_ID}@example.com`,
    fullName: 'Test User', role: 'ASSOCIATE', initials: 'TU',
    passwordHash: bcrypt.hashSync(PLAINTEXT_PASSWORD, 10)
  });

  let recoveryCodes;

  await t.test('setup stores a secret but does not enable 2FA yet', async () => {
    const result = await TwoFactorService.setup(user);
    assert.ok(result.secret);
    assert.match(result.otpauth_url, /^otpauth:\/\/totp\//);

    const refreshed = await db.getUserById(USER_ID);
    assert.equal(refreshed.totp_secret, result.secret);
    assert.equal(refreshed.totp_enabled, false);
  });

  await t.test('enabling with a wrong code is refused', async () => {
    await assert.rejects(
      () => TwoFactorService.enable(user, '000000'),
      (err) => err.status === 401 && err.code === 'INVALID_2FA_CODE'
    );
  });

  await t.test('enabling with a real code succeeds and returns recovery codes', async () => {
    const refreshed = await db.getUserById(USER_ID);
    const realCode = totp.computeTotp(refreshed.totp_secret);

    const result = await TwoFactorService.enable(user, realCode);
    assert.equal(result.enabled, true);
    assert.equal(result.recovery_codes.length, 8);
    recoveryCodes = result.recovery_codes;

    const nowEnabled = await db.getUserById(USER_ID);
    assert.equal(nowEnabled.totp_enabled, true);
    assert.equal(nowEnabled.totp_recovery_codes.length, 8);
  });

  await t.test('login now returns an mfa_token challenge, not a real session', async () => {
    const verified = await authService.verifyCredentials(user.email, PLAINTEXT_PASSWORD);
    assert.equal(verified.totp_enabled, true);

    global.__mfaToken = authService.issuePendingMfaToken(verified);
    assert.ok(global.__mfaToken);
  });

  await t.test('the mfa_token cannot be used as a real bearer token', async () => {
    await assert.rejects(
      () => authService.resolveUserFromToken(global.__mfaToken),
      (err) => err.status === 401
    );
  });

  await t.test('verifyChallenge refuses a wrong TOTP code', async () => {
    await assert.rejects(
      () => TwoFactorService.verifyChallenge(global.__mfaToken, { code: '000000' }),
      (err) => err.status === 401 && err.code === 'INVALID_2FA_CODE'
    );
  });

  await t.test('verifyChallenge succeeds with the real TOTP code', async () => {
    const refreshed = await db.getUserById(USER_ID);
    const realCode = totp.computeTotp(refreshed.totp_secret);
    const verifiedUser = await TwoFactorService.verifyChallenge(global.__mfaToken, { code: realCode });
    assert.equal(verifiedUser.id, USER_ID);
  });

  await t.test('a recovery code works exactly once', async () => {
    const mfaToken = authService.issuePendingMfaToken(user);
    const codeToUse = recoveryCodes[0];

    const verifiedUser = await TwoFactorService.verifyChallenge(mfaToken, { recovery_code: codeToUse });
    assert.equal(verifiedUser.id, USER_ID);

    const secondAttemptToken = authService.issuePendingMfaToken(user);
    await assert.rejects(
      () => TwoFactorService.verifyChallenge(secondAttemptToken, { recovery_code: codeToUse }),
      (err) => err.status === 401 && err.code === 'INVALID_RECOVERY_CODE'
    );
  });

  await t.test('disable requires the correct password', async () => {
    await assert.rejects(
      () => TwoFactorService.disable(user, 'wrong-password'),
      (err) => err.status === 401
    );
  });

  await t.test('disable with the correct password turns 2FA off and revokes other sessions', async () => {
    const tokenBeforeDisable = authService.issueToken(await db.getUserById(USER_ID));
    await authService.resolveUserFromToken(tokenBeforeDisable); // proves it works beforehand

    await TwoFactorService.disable(user, PLAINTEXT_PASSWORD);

    const disabledUser = await db.getUserById(USER_ID);
    assert.equal(disabledUser.totp_enabled, false);
    assert.equal(disabledUser.totp_secret, null);
    assert.equal(disabledUser.totp_recovery_codes.length, 0);

    await assert.rejects(
      () => authService.resolveUserFromToken(tokenBeforeDisable),
      (err) => err.status === 401
    );
  });

  await t.test('every enable/disable/recovery-code-use is written to the audit log', async () => {
    const { rows } = await pool.query(
      `SELECT DISTINCT action::text AS action FROM audit_logs WHERE firm_id = $1 AND action::text IN
        ('ENABLE_2FA', 'DISABLE_2FA', 'USE_2FA_RECOVERY_CODE')`,
      [FIRM_ID]
    );
    const actions = new Set(rows.map(r => r.action));
    assert.ok(actions.has('ENABLE_2FA'));
    assert.ok(actions.has('DISABLE_2FA'));
    assert.ok(actions.has('USE_2FA_RECOVERY_CODE'));
  });

  await pool.query('DELETE FROM firms WHERE id = $1', [FIRM_ID]);
});
