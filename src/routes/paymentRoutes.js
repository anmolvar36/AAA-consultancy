const express = require('express');
const { 
  getPayments, 
  generatePaymentLink, 
  updatePaymentStatus,
  getRefundRequests,
  createRefundRequest,
  updateRefundStatus,
  getCommissionRates,
  updateCommissionRate,
  getCommissionsReport
} = require('../controllers/paymentController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.route('/')
  .get(authMiddleware, getPayments);

router.post('/generate-link', authMiddleware, generatePaymentLink);
router.patch('/:id/status', authMiddleware, updatePaymentStatus);

// Refunds
router.get('/refunds', authMiddleware, getRefundRequests);
router.post('/refunds', authMiddleware, createRefundRequest);
router.patch('/refunds/:id/status', authMiddleware, updateRefundStatus);

// Commissions
router.get('/commissions/rates', authMiddleware, getCommissionRates);
router.patch('/commissions/rates', authMiddleware, updateCommissionRate);
router.get('/commissions/report', authMiddleware, getCommissionsReport);

module.exports = router;
