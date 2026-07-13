const express = require('express');
const { getActiveCases, getClosedCases } = require('../controllers/caseController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/active', authMiddleware, getActiveCases);
router.get('/closed', authMiddleware, getClosedCases);

module.exports = router;
