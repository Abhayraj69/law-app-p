const jwt = require('jsonwebtoken');
const baseLogger = require('../utils/logger');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');

/**
 * Authentication Service
 *
 * Issues and verifies signed JWTs. Replaces the previous model where any
 * caller could set `x-tenant-id` / `x-user-id` headers to impersonate any
 * user or firm — those headers are no longer trusted anywhere in the app.
 *
 * The token is the ONLY source of identity. It carries just the user id;
 * the live user record (role, firm, name) is re-read from Postgres on
 * every request so a role change or deactivation takes effect immediately
 * instead of being frozen inside an old token.
 *
 * Revocation (db/migrations/0020_session_revocation.sql): a signed JWT is
 * otherwise valid for its whole TTL no matter what happens in between,
 * which meant "log out" was purely cosmetic — it cleared localStorage in
 * one browser while the token itself kept working anywhere it had been
 * copied. Every token now carries a unique `jti`, and resolveUserFromToken
 * refuses one that has been individually revoked (logout) or that predates
 * the user's sessions_valid_from watermark (an admin force-logout, or a
 * password change). Both checks are made server-side on every request,
 * alongside the existing "does this user still exist" read.
 */

const TOKEN_TTL = '12h';

// A fixed dummy hash to compare against when no user matches, so that
// "unknown email" and "wrong password" take the same amount of time and
// an attacker cannot use response timing to enumerate accounts.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8u.EWMBB5vTZzHFN.wJm9DNv7tQGGa';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'your_jwt_secret_here_min_32_chars') {
    throw new Error(
      'JWT_SECRET is not configured. Set a real random value (32+ chars) in .env.local. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return secret;
}

/**
 * Verify email + password against Postgres.
 * @returns {Promise<object>} the matching user record (never includes password_hash)
 * @throws Error with .status = 401 on any mismatch
 */
async function verifyCredentials(email, password) {
  const user = await db.getUserByEmail(email);

  const hashToCheck = user ? user.password_hash : DUMMY_HASH;
  const matches = bcrypt.compareSync(String(password || ''), hashToCheck);

  if (!user || !matches) {
    const err = new Error('Invalid email or password.');
    err.status = 401;
    throw err;
  }

  return user;
}

function issueToken(user) {
  return jwt.sign(
    // jti makes an individual token addressable so it can be revoked on
    // logout; without it the only revocation available would be the
    // blunt, all-sessions-at-once kind.
    { sub: user.id, firm_id: user.firm_id, jti: crypto.randomUUID() },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

function unauthorized(message) {
  const err = new Error(message);
  err.status = 401;
  return err;
}

/**
 * Ends one session: the presented token stops working immediately,
 * everywhere, rather than only being forgotten by one browser.
 * Idempotent — logging out twice is not an error.
 *
 * `log` is optional (defaults to the request-less base logger) — pass the
 * calling request's req.log so the cleanup sweep's failure, if any, is
 * correlated back to the logout request that triggered it.
 */
async function revokeToken(token, log = baseLogger) {
  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch {
    // An already-expired or malformed token needs no revoking; treating
    // this as success keeps logout from failing in the one situation
    // where the user most wants it to just work.
    return { revoked: false, reason: 'token_not_valid' };
  }

  if (!payload.jti) {
    // Tokens issued before migration 0020 carry no jti and cannot be
    // revoked individually. Falling back to the all-sessions watermark
    // is strictly safer than silently doing nothing.
    await db.revokeAllSessionsForUser(payload.sub);
    return { revoked: true, reason: 'legacy_token_all_sessions_revoked' };
  }

  await db.revokeToken({
    jti: payload.jti,
    userId: payload.sub,
    expiresAt: new Date(payload.exp * 1000)
  });

  // Opportunistic sweep; this app has no scheduled job runner, and
  // logout is the natural moment to do it.
  db.cleanupExpiredRevocations().catch(err => {
    log.error('failed to clean up expired token revocations', { context: 'AUTH', error: err.message });
  });

  return { revoked: true, reason: 'token_revoked' };
}

/**
 * Ends EVERY session a user currently has — the departing-employee and
 * password-change case. Returns the new watermark.
 */
async function revokeAllSessions(userId) {
  return db.revokeAllSessionsForUser(userId);
}

/**
 * Verify a bearer token and resolve it to a live user record.
 * @throws Error with .status = 401 if the token is missing/invalid/expired
 *         or no longer matches a real user.
 */
async function resolveUserFromToken(token) {
  if (!token) throw unauthorized('Authentication required.');

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch (e) {
    throw unauthorized('Invalid or expired session. Please log in again.');
  }

  // Checked before the user read: a revoked token should be refused even
  // if the account behind it is perfectly healthy.
  if (await db.isTokenRevoked(payload.jti)) {
    throw unauthorized('This session has been signed out. Please log in again.');
  }

  const user = await db.getUserByIdAndFirm(payload.sub, payload.firm_id);
  if (!user) throw unauthorized('Account no longer exists.');

  // The all-sessions watermark. `iat` has whole-second resolution, and
  // db.revokeAllSessionsForUser stores a second-aligned watermark one
  // second ahead precisely so this comparison is exact rather than
  // subject to sub-second rounding — see the comment there.
  if (user.sessions_valid_from) {
    const issuedAtMs = payload.iat * 1000;
    const validFromMs = new Date(user.sessions_valid_from).getTime();
    if (issuedAtMs < validFromMs) {
      throw unauthorized('All sessions for this account were signed out. Please log in again.');
    }
  }

  return user;
}

function toPublicUser(user) {
  const { password_hash, ...publicUser } = user;
  return publicUser;
}

module.exports = {
  verifyCredentials,
  issueToken,
  resolveUserFromToken,
  revokeToken,
  revokeAllSessions,
  toPublicUser,
  TOKEN_TTL
};
