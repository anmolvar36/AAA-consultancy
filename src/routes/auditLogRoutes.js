const express = require('express');
const router = express.Router();
const { getCaseTimeline } = require('../controllers/auditLogController');
const { protect } = require('../middlewares/authMiddleware');

router.get('/timeline', protect, getCaseTimeline);

module.exports = router;
