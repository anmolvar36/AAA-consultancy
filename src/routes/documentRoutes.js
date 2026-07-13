const express = require('express');
const { getDocuments, uploadDocument, reviewDocument } = require('../controllers/documentController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

const router = express.Router();

router.route('/')
  .get(authMiddleware, getDocuments);

router.post('/upload', authMiddleware, upload.single('file'), uploadDocument);

router.patch('/:id/verify', authMiddleware, reviewDocument);

module.exports = router;
