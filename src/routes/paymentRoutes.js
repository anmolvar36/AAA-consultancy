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
const { authMiddleware, rbacMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.route('/')
  .get(authMiddleware, rbacMiddleware(['super_admin', 'admin', 'finance', 'operations']), getPayments);

router.post('/generate-link', authMiddleware, rbacMiddleware(['super_admin', 'admin', 'finance', 'operations']), generatePaymentLink);
router.patch('/:id/status', authMiddleware, rbacMiddleware(['super_admin', 'admin', 'finance']), updatePaymentStatus);
router.post('/create-checkout-session', authMiddleware, createStripeCheckoutSession);
router.post('/verify-checkout-session', authMiddleware, verifyStripeCheckoutSession);

// Refunds
router.get('/refunds', authMiddleware, rbacMiddleware(['super_admin', 'admin', 'operations', 'finance']), getRefundRequests);
router.post('/refunds', authMiddleware, createRefundRequest);
router.patch('/refunds/:id/status', authMiddleware, rbacMiddleware(['super_admin', 'admin', 'operations', 'finance']), updateRefundStatus);

// Commissions
router.get('/commissions/rates', authMiddleware, rbacMiddleware(['super_admin', 'admin', 'finance', 'operations']), getCommissionRates);
router.patch('/commissions/rates', authMiddleware, rbacMiddleware(['super_admin', 'admin', 'finance']), updateCommissionRate);
router.get('/commissions/report', authMiddleware, rbacMiddleware(['super_admin', 'admin', 'finance']), getCommissionsReport);

module.exports = router;
