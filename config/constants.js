// config.js - All application configuration and constants

require("dotenv").config({ quiet: true });

// Server Configuration
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "3cd55083223f2738ec3b05d633a6c3e5559d153c6aabf1eab3438e2ece9188adc5bb5701b468f51c08e95c8b1a2522154b5863d0f3e7e5f8d444e84fb3e873bf";

// Google Maps API Configuration
const GOOGLE_MAPS_API_KEY = process.env.WEB_GOOGLE_MAPS_API_KEY || "AIzaSyDXZWx0j9N1BdFzQ0lP3bVF8SQJlP0xUhQ";

// Booking System Configuration
const RIDE_REQUEST_TIMEOUT = 120000; // 2 minutes per driver

// Geohash Configuration
const GEOHASH_PRECISION = 6; // ~1.2km accuracy
const GEOHASH_NEIGHBORS_PRECISION = 5; // ~4.9km accuracy for expanding search

// Fare Configuration
const BASE_FARE = 50; // Base fare in currency units
const PER_KM_RATE = 10; // Per kilometer rate

// Search Configuration
const MAX_SEARCH_RADIUS_KM = 9; // Maximum search radius for drivers
const MAX_DRIVERS_TO_RETURN = 3; // Maximum number of drivers to return

module.exports = {
  PORT,
  JWT_SECRET,
  GOOGLE_MAPS_API_KEY,
  RIDE_REQUEST_TIMEOUT,
  GEOHASH_PRECISION,
  GEOHASH_NEIGHBORS_PRECISION,
  BASE_FARE,
  PER_KM_RATE,
  MAX_SEARCH_RADIUS_KM,
  MAX_DRIVERS_TO_RETURN
};
