// mapsRoutes.js - Google Maps API routes

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  geocode,
  reverseGeocode,
  getDirections,
  placeAutocomplete,
  placeDetails,
} = require('../controllers/mapsController');

// POST /api/geocode - Convert address to coordinates
router.post('/geocode', authenticateToken, geocode);

// POST /api/reverse-geocode - Convert coordinates to address
router.post('/reverse-geocode', authenticateToken, reverseGeocode);

// POST /api/directions - Get directions between two locations
router.post('/directions', authenticateToken, getDirections);

// POST /api/places/autocomplete - Place autocomplete search
router.post('/places/autocomplete', authenticateToken, placeAutocomplete);

// POST /api/places/details - Get place details by place_id
router.post('/places/details', authenticateToken, placeDetails);

module.exports = router;
