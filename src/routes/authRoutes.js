const express = require('express');
const { login, getMe, verifyMagicToken } = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { rateLimit } = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Allow up to 100 attempts per 15 min window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts from this IP, please try again after 15 minutes',
});

const router = express.Router();

router.post('/login', loginLimiter, login);
router.post('/verify-magic-token', verifyMagicToken);
router.get('/me', authMiddleware, getMe);

module.exports = router;
