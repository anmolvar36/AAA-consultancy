const express = require('express');
const router = express.Router();
const { getCaseTimeline } = require('../controllers/auditLogController');
const { optionalAuthMiddleware } = require('../middlewares/authMiddleware');

router.get('/timeline', optionalAuthMiddleware, getCaseTimeline);

module.exports = router;
