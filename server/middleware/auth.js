const authService = require('../services/authService');
const { COOKIE_NAME } = require('../utils/sessionCookie');

/**
 * Authentication & RBAC Middleware
 *
 * SECURITY NOTE: this used to trust the client-supplied `x-tenant-id` /
 * `x-user-id` headers, which let any caller impersonate any user or firm
 * (including SENIOR_PARTNER/ADMIN) just by setting a header — a critical
 * broken-access-control bug in an app that handles privileged legal
 * documents. Identity is now derived ONLY from a signed JWT verified
 * server-side; request headers are never trusted for identity or tenancy.
 *
 * The token itself is read from an HttpOnly session cookie, not an
 * Authorization header (T16, docs/DEPLOYMENT_TASKS.md) — page JavaScript,
 * including an XSS payload, cannot read an HttpOnly cookie, which closes
 * off the theft path a localStorage-held token was exposed to. See
 * server/utils/sessionCookie.js for where the cookie is set and cleared.
 */

const ROLE_HIERARCHY = {
  CLIENT: 1,
  // Ranked below PARALEGAL on purpose (Phase 6) — requireRole(minRole) is a
  // >= check, so gating a route at requireRole('INTAKE_STAFF') admits
  // INTAKE_STAFF and everyone ranked above it (PARALEGAL+), while routes
  // still gated at requireRole('PARALEGAL') correctly exclude INTAKE_STAFF.
  // See db/migrations/0027_intake_staff_role.sql.
  INTAKE_STAFF: 2,
  PARALEGAL: 3,
  ASSOCIATE: 4,
  PARTNER: 5,
  SENIOR_PARTNER: 6,
  ADMIN: 7
};

function extractToken(req) {
  return (req.cookies && req.cookies[COOKIE_NAME]) || null;
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractToken(req);
    const user = await authService.resolveUserFromToken(token);

    req.user = user;
    req.tenantId = user.firm_id;
    // Every log line for the rest of this request (including the access-log
    // line requestContext's res.on('finish') writes) now carries who made
    // it, without every call site passing user/firm ids individually.
    if (req.log) req.log = req.log.child({ user_id: user.id, firm_id: user.firm_id });
    next();
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message, code: 'UNAUTHENTICATED' });
  }
}

/**
 * Require minimum role level for sensitive routes (e.g. deleting files, altering system quotas)
 */
function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized: User authentication required.' });
    }

    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] || 99;

    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: `Forbidden: Role '${req.user.role}' lacks sufficient privilege. Required: '${minRole}'.`
      });
    }

    next();
  };
}

module.exports = {
  authMiddleware,
  requireRole,
  ROLE_HIERARCHY,
  extractToken
};
