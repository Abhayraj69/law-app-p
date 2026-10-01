const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const authService = require('./authService');
const totp = require('./totp');

/**
 * Two-Factor Authentication Service — Phase 6
 *
 * TOTP enrollment/verification lives here; the login-flow gating itself
 * (issuing a pending-MFA token instead of a real one, and exchanging it
 * for a real one after a correct code) is in authService.js/authController.js
 * — this file owns the account-settings side: setup, enable, disable, and
 * checking a submitted code or recovery code.
 *
 * Setup is two steps, not one, so a user can't lock themselves out by
 * mistyping a QR code: `setup()` generates and stores a secret but leaves
 * totp_enabled FALSE; `enable()` only flips it on after the user proves,
 * with a real code from their authenticator app, that the secret actually
 * made it in. See 0030_two_factor_auth.sql for the storage shape.
 */

const RECOVERY_CODE_COUNT = 8;
const ISSUER = 'SLF Practice Management';

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function unauthorized(message, code) {
  const err = new Error(message);
  err.status = 401;
  if (code) err.code = code;
  return err;
}

// Formatted like "XXXX-XXXX" (uppercase alphanumeric, unambiguous
// characters only) so a printed/written-down code is easy to transcribe
// correctly — same reasoning behind avoiding 0/O/1/I in the alphabet.
function generateRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

class TwoFactorService {
  /** POST /api/v1/auth/2fa/setup — starts or restarts enrollment. */
  static async setup(actingUser) {
    const secret = totp.generateSecret();
    await db.setUserTotpSecret(actingUser.id, secret);
    return {
      secret,
      otpauth_url: totp.buildOtpAuthUrl(secret, actingUser.email, ISSUER)
    };
  }

  /**
   * POST /api/v1/auth/2fa/enable — proves the secret from setup() actually
   * works, then turns 2FA on and hands back one-time recovery codes. The
   * plaintext codes exist only in this response — only their bcrypt hashes
   * are ever persisted (users.totp_recovery_codes), same posture as
   * password_hash.
   */
  static async enable(actingUser, code) {
    const user = await db.getUserById(actingUser.id);
    if (!user.totp_secret) {
      throw badRequest('Start 2FA setup before enabling it.', 'SETUP_NOT_STARTED');
    }
    if (user.totp_enabled) {
      throw badRequest('2FA is already enabled on this account.', 'ALREADY_ENABLED');
    }
    if (!totp.verifyTotp(user.totp_secret, code)) {
      throw unauthorized('That code did not match. Check your authenticator app and try again.', 'INVALID_2FA_CODE');
    }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    const hashes = recoveryCodes.map(rc => bcrypt.hashSync(rc, 10));
    await db.enableUserTotp(user.id, hashes);

    await db.insertAuditLog({
      firmId: user.firm_id, userId: user.id, action: 'ENABLE_2FA', details: { self: true }
    });

    return { enabled: true, recovery_codes: recoveryCodes };
  }

  /**
   * POST /api/v1/auth/2fa/disable — requires the current password as
   * re-authentication (disabling 2FA is a security-lowering action), and
   * signs the account out everywhere else, same as an admin force-logout —
   * a stolen session shouldn't be able to both disable 2FA and keep running
   * elsewhere afterward.
   */
  static async disable(actingUser, password) {
    await authService.verifyCredentials(actingUser.email, password);
    await db.disableUserTotp(actingUser.id);
    await authService.revokeAllSessions(actingUser.id);

    await db.insertAuditLog({
      firmId: actingUser.firm_id, userId: actingUser.id, action: 'DISABLE_2FA', details: { self: true }
    });

    return { disabled: true };
  }

  /**
   * Used by authController.verifyLogin — resolves the pending-MFA token
   * from step one of login, checks either a TOTP code or a recovery code,
   * and returns the live user row on success. Never issues a token itself
   * (authController does that with authService.issueToken, exactly like a
   * normal login) so this stays pure verification.
   */
  static async verifyChallenge(mfaToken, { code, recovery_code }) {
    const payload = authService.resolvePendingMfaToken(mfaToken);
    const user = await db.getUserByIdAndFirm(payload.sub, payload.firm_id);
    if (!user || !user.totp_enabled) {
      throw unauthorized('2FA is not enabled on this account.');
    }

    if (recovery_code) {
      const candidate = String(recovery_code).trim().toUpperCase();
      const matchedHash = (user.totp_recovery_codes || []).find(hash => bcrypt.compareSync(candidate, hash));
      if (!matchedHash) throw unauthorized('That recovery code is invalid or has already been used.', 'INVALID_RECOVERY_CODE');

      await db.consumeUserRecoveryCode(user.id, matchedHash);
      await db.insertAuditLog({
        firmId: user.firm_id, userId: user.id, action: 'USE_2FA_RECOVERY_CODE', details: { self: true }
      });
      return user;
    }

    if (!totp.verifyTotp(user.totp_secret, code)) {
      throw unauthorized('That code did not match. Check your authenticator app and try again.', 'INVALID_2FA_CODE');
    }
    return user;
  }
}

module.exports = TwoFactorService;
