// routes/safetyRoutes.js — Live tracking and safety contact routes

const express = require('express');
const router  = express.Router();
const { getLiveTrackPage, getLiveTrackLocation } = require('../controllers/safetyController');

// Public — no auth required (token-gated internally)
// GET /live-track/:token  → HTML live tracking page
router.get('/live-track/:token', getLiveTrackPage);

// GET /api/live-track/:token/location  → JSON driver position (called by tracking page JS)
router.get('/live-track/:token/location', getLiveTrackLocation);

module.exports = router;
