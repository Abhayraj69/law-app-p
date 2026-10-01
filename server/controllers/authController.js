const authService = require('../services/authService');
const TwoFactorService = require('../services/twoFactorService');
const db = require('../db');
const { extractToken } = require('../middleware/auth');
const { setSessionCookie, clearSessionCookie } = require('../utils/sessionCookie');

/**
 * Auth Controller
 * POST /api/v1/auth/login          — exchange email+password for a JWT, or
 *                                     an mfa_token challenge if 2FA is on.
 * POST /api/v1/auth/2fa/verify-login — exchange an mfa_token + code for a JWT.
 * GET  /api/v1/auth/me             — return the identity resolved from the current token.
 * POST /api/v1/auth/logout         — revoke the presented token server-side.
 * POST /api/v1/auth/2fa/setup      — start/restart TOTP enrollment (authenticated).
 * POST /api/v1/auth/2fa/enable     — confirm enrollment with a real code.
 * POST /api/v1/auth/2fa/disable    — turn 2FA off (requires password).
 */

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required.' });
    }

    const user = await authService.verifyCredentials(email, password);

    // Password was correct, but that's not enough on its own — hand back a
    // short-lived challenge token instead of a real session (see
    // authService.issuePendingMfaToken's comment).
    if (user.totp_enabled) {
      return res.json({
        success: true,
        data: { mfa_required: true, mfa_token: authService.issuePendingMfaToken(user) }
      });
    }

    const token = authService.issueToken(user);
    // Delivered ONLY via the HttpOnly cookie, never in the JSON body — see
    // server/utils/sessionCookie.js for why. The client never sees the raw
    // token and has nothing to store for it.
    setSessionCookie(res, token);
    res.json({
      success: true,
      data: {
        expires_in: authService.TOKEN_TTL,
        user: authService.toPublicUser(user)
      }
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/auth/2fa/verify-login — step two of login when 2FA is on. */
async function verifyLogin(req, res, next) {
  try {
    const { mfa_token, code, recovery_code } = req.body || {};
    if (!mfa_token || (!code && !recovery_code)) {
      return res.status(400).json({ success: false, error: 'mfa_token and either code or recovery_code are required.' });
    }

    const user = await TwoFactorService.verifyChallenge(mfa_token, { code, recovery_code });
    const token = authService.issueToken(user);
    setSessionCookie(res, token);

    res.json({
      success: true,
      data: {
        expires_in: authService.TOKEN_TTL,
        user: authService.toPublicUser(user)
      }
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/auth/2fa/setup — authenticated; starts or restarts enrollment. */
async function setup2fa(req, res, next) {
  try {
    const result = await TwoFactorService.setup(req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/auth/2fa/enable — authenticated; confirms enrollment with a real code. */
async function enable2fa(req, res, next) {
  try {
    const result = await TwoFactorService.enable(req.user, req.body?.code);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/auth/2fa/disable — authenticated; requires the current password. */
async function disable2fa(req, res, next) {
  try {
    const result = await TwoFactorService.disable(req.user, req.body?.password);
    res.json({ success: true, data: result });
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
    const token = extractToken(req);

    if (token) await authService.revokeToken(token, req.log);
    clearSessionCookie(res);

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

module.exports = { login, verifyLogin, me, logout, setup2fa, enable2fa, disable2fa };
