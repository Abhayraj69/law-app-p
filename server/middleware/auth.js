const authService = require('../services/authService');

/**
 * Authentication & RBAC Middleware
 *
 * SECURITY NOTE: this used to trust the client-supplied `x-tenant-id` /
 * `x-user-id` headers, which let any caller impersonate any user or firm
 * (including SENIOR_PARTNER/ADMIN) just by setting a header — a critical
 * broken-access-control bug in an app that handles privileged legal
 * documents. Identity is now derived ONLY from a signed JWT verified
 * server-side; request headers are never trusted for identity or tenancy.
 */

const ROLE_HIERARCHY = {
  CLIENT: 1,
  PARALEGAL: 2,
  ASSOCIATE: 3,
  PARTNER: 4,
  SENIOR_PARTNER: 5,
  ADMIN: 6
};

function extractBearerToken(req) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractBearerToken(req);
    const user = await authService.resolveUserFromToken(token);

    req.user = user;
    req.tenantId = user.firm_id;
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
  ROLE_HIERARCHY
};
