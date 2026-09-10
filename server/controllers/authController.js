const authService = require('../services/authService');

/**
 * Auth Controller
 * POST /api/v1/auth/login — exchange email+password for a JWT.
 * GET  /api/v1/auth/me    — return the identity resolved from the current token.
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

module.exports = { login, me };
