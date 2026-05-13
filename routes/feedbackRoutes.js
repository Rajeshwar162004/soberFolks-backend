// feedbackRoutes.js - Ride feedback and ratings routes

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  submitFeedback,
  getRideFeedback,
  getDriverSummary,
} = require('../controllers/feedbackController');

// POST /api/feedback/submit - Submit feedback for a ride
router.post('/submit', authenticateToken, submitFeedback);

// GET /api/feedback/ride/:rideId - Get feedback for a specific ride
router.get('/ride/:rideId', authenticateToken, getRideFeedback);

// GET /api/feedback/driver/:driverId/summary - Get driver's aggregate rating
router.get('/driver/:driverId/summary', getDriverSummary);

module.exports = router;
