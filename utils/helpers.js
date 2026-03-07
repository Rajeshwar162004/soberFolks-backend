// helpers.js - General utility functions

// Convert date from DD/MM/YYYY to YYYY-MM-DD format
const convertDateFormat = (ddmmyyyy) => {
  const [day, month, year] = ddmmyyyy.split("/");
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

module.exports = {
  convertDateFormat
};

// -------- Distance and Fare Calculations --------
// Calculate distance between two coordinates (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in kilometers
};

// Calculate fare based on distance
const calculateFare = (distanceKm) => {
  const baseFare = 50; // Base fare in rupees
  const perKmRate = 15; // Rate per km
  return Math.round(baseFare + (distanceKm * perKmRate));
};

// -------- Geohash Utilities --------
// Generate geohash for coordinates
const generateGeohash = (latitude, longitude) => {
  return ngeohash.encode(latitude, longitude, GEOHASH_PRECISION);
};

// Get neighboring geohashes for expanded search
const getNeighboringGeohashes = (latitude, longitude) => {
  const baseGeohash = ngeohash.encode(latitude, longitude, GEOHASH_NEIGHBORS_PRECISION);
  return ngeohash.neighbors(baseGeohash);
};

// Update location with geohash
const updateLocationWithGeohash = async (userId, latitude, longitude, address, role) => {
  const geohash = generateGeohash(latitude, longitude);
  const table = role === "Consumer" ? "consumer_locations" : "driver_locations";
  
  const updateQuery = `
    UPDATE ${table} 
    SET latitude = $1, longitude = $2, address = $3, geohash = $4, updated_at = NOW() 
    WHERE user_id = $5
  `;

  try {
    const result = await db.query(updateQuery, [latitude, longitude, address, geohash, userId]);
    
    if (result.rowCount === 0) {
      // Insert new location if doesn't exist
      const insertQuery = `
        INSERT INTO ${table} (user_id, latitude, longitude, address, geohash, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      `;
      await db.query(insertQuery, [userId, latitude, longitude, address, geohash]);
    }
  } catch (err) {
    console.error('Error updating location with geohash:', err);
    throw err;
  }
};

// -------- Google Maps API Functions --------
// Geocode address to coordinates
const geocodeAddress = async (address) => {
  try {
    const encodedAddress = encodeURIComponent(address.trim());
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${GOOGLE_MAPS_API_KEY}`;
    
    console.log(`🔍 Geocoding address: "${address}"`);
    
    const response = await axios.get(url);
    
    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const location = result.geometry.location;
      
      console.log(`✅ Geocoding successful: ${location.lat}, ${location.lng}`);
      
      return {
        lat: location.lat,
        lng: location.lng,
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        types: result.types
      };
    } else if (response.data.status === 'ZERO_RESULTS') {
      console.warn(`⚠️ No results found for address: "${address}"`);
      throw new Error(`Location not found: ${address}`);
    } else {
      console.error(`❌ Geocoding API error: ${response.data.status}`);
      throw new Error(`Geocoding failed: ${response.data.status}`);
    }
  } catch (error) {
    console.error('❌ Geocoding error:', error.message);
    
    if (error.response) {
      throw new Error(`Geocoding API error: ${error.response.status}`);
    } else if (error.request) {
      throw new Error('Network error while geocoding');
    } else {
      throw error;
    }
  }
};

// Reverse geocode coordinates to address
const reverseGeocode = async (latitude, longitude) => {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${GOOGLE_MAPS_API_KEY}`;
    
    console.log(`🔍 Reverse geocoding coordinates: ${latitude}, ${longitude}`);
    
    const response = await axios.get(url);
    
    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      
      console.log(`✅ Reverse geocoding successful: ${result.formatted_address}`);
      
      return {
        formatted_address: result.formatted_address,
        place_id: result.place_id,
        address_components: result.address_components,
        types: result.types
      };
    } else if (response.data.status === 'ZERO_RESULTS') {
      console.warn(`⚠️ No address found for coordinates: ${latitude}, ${longitude}`);
      return {
        formatted_address: `Location near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        place_id: null,
        address_components: [],
        types: []
      };
    } else {
      console.error(`❌ Reverse geocoding API error: ${response.data.status}`);
      throw new Error(`Reverse geocoding failed: ${response.data.status}`);
    }
  } catch (error) {
    console.error('❌ Reverse geocoding error:', error.message);
    
    return {
      formatted_address: `Location near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      place_id: null,
      address_components: [],
      types: []
    };
  }
};

// Decode Google's polyline format
function decodePolyline(encoded) {
  const poly = [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;

  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;
    
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    
    const dlat = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
    lat += dlat;

    shift = 0;
    result = 0;
    
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    
    const dlng = ((result & 1) !== 0 ? ~(result >> 1) : (result >> 1));
    lng += dlng;

    poly.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return poly;
}

module.exports = {
  convertDateFormat,
  calculateDistance,
  calculateFare,
  generateGeohash,
  getNeighboringGeohashes,
  updateLocationWithGeohash,
  geocodeAddress,
  reverseGeocode,
  decodePolyline,
};
