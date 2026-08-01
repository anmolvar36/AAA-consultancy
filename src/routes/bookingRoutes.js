const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Eligibility Booking
router.post('/eligibility', bookingController.createEligibilityBooking);
router.get('/prefill', bookingController.verifyPrefillToken);

// Translation Upload
router.post('/translation/upload', upload.single('document'), bookingController.uploadTranslationDocument);

// Translation Checkout (disk storage)
const uploadDisk = require('../middlewares/uploadMiddleware');
router.post('/translation/checkout', uploadDisk.single('document'), bookingController.checkoutTranslationDocument);

module.exports = router;
