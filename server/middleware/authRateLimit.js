const rateLimit = require('express-rate-limit');

/**
 * Rate limiting for authentication endpoints.
 *
 * POST /auth/login had no throttling at all — an attacker could brute-force
 * or credential-stuff passwords against it at unlimited speed. This limits
 * repeated attempts per source IP, independent of whether the login itself
 * succeeds or fails.
 *
 * Window/limit are configurable via env vars so they can be tuned per
 * environment (e.g. relaxed for local dev/test, tightened in production)
 * without a code change. Defaults: 10 attempts per IP per 15 minutes.
 *
 * Store: express-rate-limit defaults to an in-memory store, which is fine
 * for a single instance but wrong for more than one — each instance would
 * keep its own counter, so N instances multiply the real limit by N, and
 * every counter resets on deploy. Set RATE_LIMIT_STORE=postgres once
 * running more than one instance to share counters across them via the
 * database that's already there (no new infrastructure required).
 */

const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const max = Number(process.env.AUTH_RATE_LIMIT_MAX) || 10;

function buildStore() {
  if (process.env.RATE_LIMIT_STORE !== 'postgres') return undefined;
  const { PostgresStore } = require('@acpr/rate-limit-postgresql');
  const { buildPoolConfig } = require('../db/pool');
  // PostgresStore manages its own dedicated connection pool (it applies its
  // own migrations and opens its own Pool internally) rather than reusing
  // the app's shared pool object, so it's handed the same connection
  // config the app's own pool is built from — not the pool instance itself.
  return new PostgresStore(buildPoolConfig(), 'auth_rl');
}

const authRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore(),
  // Matches the error response shape used elsewhere in server/routes/auth.js
  // and server/controllers/authController.js.
  handler(req, res) {
    res.status(429).json({
      success: false,
      error: 'Too many attempts. Please try again later.',
      code: 'RATE_LIMITED'
    });
  }
});

module.exports = { authRateLimiter };
