const authService = require('../services/authService');
const db = require('../db');

/**
 * Auth Controller
 * POST /api/v1/auth/login  — exchange email+password for a JWT.
 * GET  /api/v1/auth/me     — return the identity resolved from the current token.
 * POST /api/v1/auth/logout — revoke the presented token server-side.
 */

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = await authService.verifyCredentials(email, password);
    const token = authService.issueToken(user);

    res.json({
      success: true,
      data: {
        token,
        expires_in: authService.TOKEN_TTL,
        user: authService.toPublicUser(user)
      }
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    // req.user is populated by authMiddleware from a verified token.
    res.json({ success: true, data: authService.toPublicUser(req.user) });
  } catch (err) {
    next(err);
  }
}

/**
 * Ends the current session server-side. Behind authMiddleware, so the
 * token is already known to be valid and to belong to req.user — a caller
 * can therefore only ever revoke their own session here, never someone
 * else's (that is the ADMIN-gated route in routes/api.js).
 */
async function logout(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = match ? match[1] : null;

    if (token) await authService.revokeToken(token);

    await db.insertAuditLog({
      firmId: req.tenantId,
      userId: req.user.id,
      action: 'LOGOUT',
      details: { self: true }
    });

    res.json({ success: true, data: { message: 'Signed out.' } });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, me, logout };
