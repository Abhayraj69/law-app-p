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
 */

const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const max = Number(process.env.AUTH_RATE_LIMIT_MAX) || 10;

const authRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
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
