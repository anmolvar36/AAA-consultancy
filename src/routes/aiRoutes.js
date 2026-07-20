const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

// Role-based auth middleware would typically wrap this
router.post('/summarize-client', aiController.summarizeClient);
router.post('/extract-intent', aiController.extractIntent);
router.post('/score-consultants', aiController.scoreConsultants);
router.post('/analyze-translation-pdf', aiController.analyzeTranslationPdf);

module.exports = router;
