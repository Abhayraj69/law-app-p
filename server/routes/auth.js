const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { authMiddleware } = require('../middleware/auth');

// Public — issues a JWT
router.post('/login', authController.login);

// Requires a valid token — confirms who it belongs to
router.get('/me', authMiddleware, authController.me);

module.exports = router;
