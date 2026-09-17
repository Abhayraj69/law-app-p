const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const inviteController = require('../controllers/inviteController');
const signatureController = require('../controllers/signatureController');
const { authMiddleware } = require('../middleware/auth');
const { authRateLimiter } = require('../middleware/authRateLimit');

// Applies to every route below, not just /login: /invite/:token/accept and
// /sign/:token/complete both take a bearer-token-like secret over an
// unauthenticated POST and are just as brute-forceable, so they get the
// same per-IP throttle.
router.use(authRateLimiter);

// Public — issues a JWT
router.post('/login', authController.login);

// Requires a valid token — confirms who it belongs to
router.get('/me', authMiddleware, authController.me);

// Requires a valid token — revokes it server-side, so the session ends
// everywhere rather than only being forgotten by one browser. You can only
// ever end your OWN session here; ending someone else's is
// POST /api/v1/admin/users/:id/revoke-sessions, which is ADMIN-gated.
router.post('/logout', authMiddleware, authController.logout);

// Public — an invitee has no account (and so no token) until they accept.
// Deliberately outside authMiddleware; see server/services/inviteService.js.
router.get('/invite/:token', inviteController.getInvitePreview);
router.post('/invite/:token/accept', inviteController.acceptInvite);

// Public — the signer of an e-signature request has no account either.
// Deliberately outside authMiddleware; see server/services/signatureService.js.
router.get('/sign/:token', signatureController.getPublicSigningView);
router.post('/sign/:token/complete', signatureController.completeSigning);

module.exports = router;
