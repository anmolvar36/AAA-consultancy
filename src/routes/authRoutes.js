const express = require('express');
const { login, getMe } = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/login', login);
router.get('/me', authMiddleware, getMe);

module.exports = router;
