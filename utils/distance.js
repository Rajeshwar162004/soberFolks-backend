// distance.js - Distance calculation and fare calculation utilities

const { BASE_FARE, PER_KM_RATE } = require("../config/constants");

// Haversine formula to calculate distance between two lat/lng points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

// Calculate fare based on distance
function calculateFare(distanceKm) {
  return BASE_FARE + distanceKm * PER_KM_RATE;
}

module.exports = {
  calculateDistance,
  calculateFare
};
