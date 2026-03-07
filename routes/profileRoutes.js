// profileRoutes.js - User profile routes

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  getProfile,
  updateDriverAvailability,
  getDriverProfile,
} = require('../controllers/rideController');

// GET /profile/:role/:id - Get user profile (Consumer or Driver)
router.get('/:role/:id', authenticateToken, getProfile);

// PUT /driver/:id/availability - Update driver availability status
router.put('/:id/availability', authenticateToken, updateDriverAvailability);

module.exports = router;
