// locationRoutes.js - Location tracking routes

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { updateLocation, getCurrentLocation } = require('../controllers/locationController');

// POST /api/location/update - Update user location with geohash
router.post('/update', authenticateToken, updateLocation);

// GET /api/location/current - Get user's current location
router.get('/current', authenticateToken, getCurrentLocation);

module.exports = router;
