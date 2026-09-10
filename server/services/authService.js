const jwt = require('jsonwebtoken');
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
    { sub: user.id, firm_id: user.firm_id },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

/**
 * Verify a bearer token and resolve it to a live user record.
 * @throws Error with .status = 401 if the token is missing/invalid/expired
 *         or no longer matches a real user.
 */
async function resolveUserFromToken(token) {
  if (!token) {
    const err = new Error('Authentication required.');
    err.status = 401;
    throw err;
  }

  let payload;
  try {
    payload = jwt.verify(token, getJwtSecret());
  } catch (e) {
    const err = new Error('Invalid or expired session. Please log in again.');
    err.status = 401;
    throw err;
  }

  const user = await db.getUserByIdAndFirm(payload.sub, payload.firm_id);
  if (!user) {
    const err = new Error('Account no longer exists.');
    err.status = 401;
    throw err;
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
  toPublicUser,
  TOKEN_TTL
};
