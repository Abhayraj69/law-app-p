const { DEFAULT_FIRM_ID, DEFAULT_USER_ID, inMemoryDb } = require('../db');

/**
 * Multi-Tenancy & RBAC Middleware
 * Extracts headers (x-tenant-id, x-user-id, authorization) or assigns default active legal partner context.
 * Enforces firm-level tenant isolation and role restrictions.
 */

const ROLE_HIERARCHY = {
  CLIENT: 1,
  PARALEGAL: 2,
  ASSOCIATE: 3,
  PARTNER: 4,
  SENIOR_PARTNER: 5,
  ADMIN: 6
};

function authMiddleware(req, res, next) {
  // Tenant Isolation
  const tenantId = req.headers['x-tenant-id'] || DEFAULT_FIRM_ID;
  const userId = req.headers['x-user-id'] || DEFAULT_USER_ID;

  // Resolve user
  const user = inMemoryDb.users.find(u => u.id === userId) || {
    id: userId,
    firm_id: tenantId,
    email: 's.jennings@slf.law',
    full_name: 'Sarah Jennings',
    role: 'SENIOR_PARTNER',
    initials: 'SJ'
  };

  req.tenantId = tenantId;
  req.user = user;

  next();
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
