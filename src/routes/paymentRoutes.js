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
  getCommissionsReport,
  createStripeCheckoutSession,
  verifyStripeCheckoutSession
} = require('../controllers/paymentController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.route('/')
  .get(authMiddleware, getPayments);

router.post('/generate-link', authMiddleware, generatePaymentLink);
router.patch('/:id/status', authMiddleware, updatePaymentStatus);
router.post('/create-checkout-session', authMiddleware, createStripeCheckoutSession);
router.post('/verify-checkout-session', authMiddleware, verifyStripeCheckoutSession);

// Refunds
router.get('/refunds', authMiddleware, getRefundRequests);
router.post('/refunds', authMiddleware, createRefundRequest);
router.patch('/refunds/:id/status', authMiddleware, updateRefundStatus);

// Commissions
router.get('/commissions/rates', authMiddleware, getCommissionRates);
router.patch('/commissions/rates', authMiddleware, updateCommissionRate);
router.get('/commissions/report', authMiddleware, getCommissionsReport);

module.exports = router;
