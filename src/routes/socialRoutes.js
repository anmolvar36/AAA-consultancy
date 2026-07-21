const express = require('express');
const router = express.Router();
const socialController = require('../controllers/socialController');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.get('/conversations', authMiddleware, socialController.getConversations);
router.get('/messages/:phone', authMiddleware, socialController.getMessagesByPhone);
router.post('/messages/send', authMiddleware, socialController.sendSocialMessage);

module.exports = router;
