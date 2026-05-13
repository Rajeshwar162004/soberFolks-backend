// rideRoutes.js - All ride and profile routes

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  findDrivers,
  requestRide,
  getPendingRides,
  acceptRide,
  rejectRide,
  getRideStatus,
  getActiveRide,
  getRideHistory,
  startRide,
  cancelRide,
  completeRide,
  getProfile,
  updateDriverAvailability,
  getDriverProfile,
} = require('../controllers/rideController');

// ===== Ride Management Routes =====

// POST /api/rides/find-drivers - Find nearby available drivers
router.post('/find-drivers', authenticateToken, findDrivers);

// POST /api/rides/request - Create new ride request
router.post('/request', authenticateToken, requestRide);

// GET /api/rides/active - Get current active ride
router.get('/active', authenticateToken, getActiveRide);

// GET /api/rides/history - Get ride history
router.get('/history', authenticateToken, getRideHistory);

// GET /api/rides/:rideId/status - Get ride status
router.get('/:rideId/status', authenticateToken, getRideStatus);

// POST /api/rides/:rideId/accept - Driver accepts ride
router.post('/:rideId/accept', authenticateToken, acceptRide);

// POST /api/rides/:rideId/reject - Driver rejects ride
router.post('/:rideId/reject', authenticateToken, rejectRide);

// POST /api/rides/:rideId/start - Driver starts ride
router.post('/:rideId/start', authenticateToken, startRide);

// POST /api/rides/:rideId/cancel - Cancel ride
router.post('/:rideId/cancel', authenticateToken, cancelRide);

// POST /api/rides/:rideId/complete - Driver completes ride
router.post('/:rideId/complete', authenticateToken, completeRide);

// ===== Driver-specific Routes =====

// GET /api/driver/pending-rides - Get pending ride requests for driver
router.get('/driver/pending-rides', authenticateToken, getPendingRides);

// GET /api/driver/profile - Get driver profile
router.get('/driver/profile', authenticateToken, getDriverProfile);

module.exports = router;
