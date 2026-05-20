// paymentRoutes.js - Payment API Routes

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const paymentController = require('../controllers/paymentController');

/**
 * @route   POST /api/payments/create-order
 * @desc    Create Razorpay order for ride payment
 * @access  Consumer only
 */
router.post('/create-order', authenticateToken, paymentController.createOrder);

/**
 * @route   POST /api/payments/verify
 * @desc    Verify Razorpay payment signature
 * @access  Consumer only
 */
router.post('/verify', authenticateToken, paymentController.verifyPayment);

/**
 * @route   GET /api/payments/ride/:rideId
 * @desc    Get payment details for a specific ride
 * @access  Consumer or Driver (ride participants only)
 */
router.get('/ride/:rideId', authenticateToken, paymentController.getPaymentDetails);

/**
 * @route   POST /api/payments/retry/:rideId
 * @desc    Retry failed payment for a ride
 * @access  Consumer only
 */
router.post('/retry/:rideId', authenticateToken, paymentController.retryPayment);

/**
 * @route   POST /api/payments/failed
 * @desc    Handle payment failure notification from client
 * @access  Consumer only
 */
router.post('/failed', authenticateToken, paymentController.handlePaymentFailure);

module.exports = router;
