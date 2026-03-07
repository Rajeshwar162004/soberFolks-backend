// locationController.js - Location tracking and updates

const db = require("../db");
const { updateLocationWithGeohash, generateGeohash } = require("../utils/geohash");
const { reverseGeocode } = require("../utils/geocoding");

// Update User Location (Consumer or Driver)
const updateLocation = async (req, res) => {
  const { latitude, longitude, address } = req.body;
  const { id, role } = req.user;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: "Latitude and longitude are required" });
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  let locationAddress = address;
  
  // Auto-resolve address if not provided
  if (!locationAddress) {
    try {
      const reverseGeoResult = await reverseGeocode(latitude, longitude);
      locationAddress = reverseGeoResult.formatted_address || reverseGeoResult;
      console.log(`📍 Auto-resolved address: ${locationAddress}`);
    } catch (error) {
      console.warn('Failed to reverse geocode:', error.message);
      locationAddress = `Location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`;
    }
  }

  try {
    await updateLocationWithGeohash(id, latitude, longitude, locationAddress, role);
    
    res.json({
      message: "Location updated successfully",
      location: { 
        latitude: parseFloat(latitude), 
        longitude: parseFloat(longitude), 
        address: locationAddress,
        geohash: generateGeohash(latitude, longitude)
      }
    });
  } catch (error) {
    console.error("Location update error:", error);
    res.status(500).json({ error: "Failed to update location" });
  }
};

// Get User's Current Location
const getCurrentLocation = async (req, res) => {
  const { id, role } = req.user;
  const table = role === "Consumer" ? "consumer_locations" : "driver_locations";

  const query = `SELECT * FROM ${table} WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`;

  try {
    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No location data found" });
    }

    const location = result.rows[0];
    res.json({
      latitude: parseFloat(location.latitude),
      longitude: parseFloat(location.longitude),
      address: location.address,
      geohash: location.geohash,
      lastUpdated: location.updated_at
    });
  } catch (err) {
    console.error("Get location error:", err);
    return res.status(500).json({ error: "Failed to fetch location" });
  }
};

module.exports = {
  updateLocation,
  getCurrentLocation,
};
