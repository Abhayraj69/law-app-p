const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const inviteController = require('../controllers/inviteController');
const { authMiddleware } = require('../middleware/auth');

// Public — issues a JWT
router.post('/login', authController.login);

// Requires a valid token — confirms who it belongs to
router.get('/me', authMiddleware, authController.me);

// Public — an invitee has no account (and so no token) until they accept.
// Deliberately outside authMiddleware; see server/services/inviteService.js.
router.get('/invite/:token', inviteController.getInvitePreview);
router.post('/invite/:token/accept', inviteController.acceptInvite);

module.exports = router;
