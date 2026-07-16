const express = require('express');
const { getDocuments, uploadDocument, reviewDocument } = require('../controllers/documentController');
const { authMiddleware, rbacMiddleware } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

const router = express.Router();

router.route('/')
  .get(authMiddleware, getDocuments);

router.post('/upload', authMiddleware, upload.single('file'), uploadDocument);

router.patch('/:id/verify', authMiddleware, rbacMiddleware(['super_admin', 'admin', 'operations', 'consultant']), reviewDocument);

module.exports = router;
