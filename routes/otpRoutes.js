// otpRoutes.js - OTP verification routes

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  generatePickupOTP,
  verifyPickupOTP,
  generateDropOTP,
  verifyDropOTP,
  getOTPStatus
} = require('../controllers/otpController');

// Pickup OTP routes
router.post('/rides/:rideId/generate-pickup', authenticateToken, generatePickupOTP);
router.post('/rides/:rideId/verify-pickup', authenticateToken, verifyPickupOTP);

// Drop OTP routes
router.post('/rides/:rideId/generate-drop', authenticateToken, generateDropOTP);
router.post('/rides/:rideId/verify-drop', authenticateToken, verifyDropOTP);

// Get OTP status
router.get('/rides/:rideId/status', authenticateToken, getOTPStatus);

module.exports = router;
