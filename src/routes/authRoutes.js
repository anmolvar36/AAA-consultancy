const express = require('express');
const { login, getMe, verifyMagicToken } = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/login', login);
router.post('/verify-magic-token', verifyMagicToken);
router.get('/me', authMiddleware, getMe);

module.exports = router;
