const express = require('express');
const { getConsultations, createConsultation, updateOutcome, respondToConsultation, createConsultationForLead } = require('../controllers/consultationController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.route('/')
  .get(authMiddleware, getConsultations)
  .post(createConsultation); // Public booking link

router.patch('/:id/outcome', authMiddleware, updateOutcome);
router.patch('/:id/respond', authMiddleware, respondToConsultation);
router.post('/create-for-lead', authMiddleware, createConsultationForLead);

module.exports = router;

