const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Request Context
 *
 * Mounted first, ahead of every other middleware (including
 * securityHeaders), so that even a request rejected by CORS or the
 * security headers layer still gets a request id and an access-log line —
 * the two things you most want when something failed before it ever
 * reached a route handler.
 *
 * Gives every request:
 *   - req.requestId — a fresh UUID, also returned as the X-Request-Id
 *     response header so a client-reported bug can be matched back to its
 *     exact server-side log lines.
 *   - req.log — a logger (server/utils/logger.js) pre-tagged with
 *     request_id. server/middleware/auth.js's authMiddleware re-assigns
 *     this to req.log.child({user_id, firm_id}) once it resolves an
 *     identity, so every log line for an authenticated request is
 *     correlated to who made it without each call site doing that itself.
 *   - one 'request completed' access-log line on res.finish, with method,
 *     path, status and duration — there was no access logging anywhere in
 *     this app before this middleware; every deployment previously had no
 *     record of what was actually served short of the database's own
 *     audit_logs table, which only covers specific in-app actions, not
 *     HTTP traffic in general.
 */
function requestContext(req, res, next) {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  req.log = logger.child({ context: 'HTTP', request_id: requestId });
  res.setHeader('X-Request-Id', requestId);

  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    req.log.info('request completed', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Math.round(durationMs)
    });
  });

  next();
}

module.exports = requestContext;
