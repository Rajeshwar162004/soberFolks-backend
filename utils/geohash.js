// geohash.js - Geohash utilities for location-based searching

const ngeohash = require("ngeohash");
const { GEOHASH_PRECISION, GEOHASH_NEIGHBORS_PRECISION } = require("../config/constants");
const db = require("../db");

// Generate geohash from latitude and longitude
function generateGeohash(latitude, longitude, precision = GEOHASH_PRECISION) {
  return ngeohash.encode(latitude, longitude, precision);
}

// Get neighboring geohashes for expanding search radius
// This function now accepts latitude and longitude (NOT a geohash string)
function getNeighboringGeohashes(latitude, longitude) {
  try {
    // First encode the lat/lon to a geohash with lower precision for wider search
    const baseGeohash = ngeohash.encode(latitude, longitude, GEOHASH_NEIGHBORS_PRECISION);
    
    // Get all 8 neighboring geohashes
    const neighbors = ngeohash.neighbors(baseGeohash);
    
    // Return as array of neighbor geohash values
    return Object.values(neighbors);
  } catch (error) {
    console.error("Error getting neighboring geohashes:", error);
    return [];
  }
}

// Update location with geohash
async function updateLocationWithGeohash(userId, latitude, longitude, address, role) {
  const geohash = generateGeohash(latitude, longitude);
  const table = role === "Consumer" ? "consumer_locations" : "driver_locations";
  
  // Check if location exists
  const checkQuery = `SELECT id FROM ${table} WHERE user_id = $1`;
  const existingLocation = await db.query(checkQuery, [userId]);
  
  if (existingLocation.rows.length > 0) {
    // Update existing location
    await db.query(
      `UPDATE ${table} 
       SET latitude = $1, longitude = $2, geohash = $3, address = $4, updated_at = NOW() 
       WHERE user_id = $5`,
      [latitude, longitude, geohash, address, userId]
    );
  } else {
    // Insert new location
    await db.query(
      `INSERT INTO ${table} (user_id, latitude, longitude, geohash, address, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [userId, latitude, longitude, geohash, address]
    );
  }
  
  return geohash;
}

module.exports = {
  generateGeohash,
  getNeighboringGeohashes,
  updateLocationWithGeohash
};
