// geocoding.js - Google Maps API integration for geocoding and directions

const axios = require("axios");
const { GOOGLE_MAPS_API_KEY } = require("../config/constants");

// Geocode an address to get lat/lng
async function geocodeAddress(address) {
  try {
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address,
          key: GOOGLE_MAPS_API_KEY,
        },
      }
    );

    if (response.data.status === "OK" && response.data.results.length > 0) {
      const location = response.data.results[0].geometry.location;
      return {
        latitude: location.lat,
        longitude: location.lng,
        formattedAddress: response.data.results[0].formatted_address,
      };
    } else {
      throw new Error(`Geocoding failed: ${response.data.status}`);
    }
  } catch (error) {
    console.error("Geocoding error:", error.message);
    throw error;
  }
}

// Reverse geocode lat/lng to get address
async function reverseGeocode(latitude, longitude) {
  try {
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          latlng: `${latitude},${longitude}`,
          key: GOOGLE_MAPS_API_KEY,
        },
      }
    );

    if (response.data.status === "OK" && response.data.results.length > 0) {
      return {
        formatted_address: response.data.results[0].formatted_address,
        place_id: response.data.results[0].place_id,
        address_components: response.data.results[0].address_components
      };
    } else {
      console.warn(`Reverse geocoding returned status: ${response.data.status}`);
      throw new Error(`Reverse geocoding failed: ${response.data.status}`);
    }
  } catch (error) {
    console.error("Reverse geocoding error:", error.message);
    throw error;
  }
}

// Decode polyline from Google Maps Directions API
function decodePolyline(encoded) {
  if (!encoded) return [];
  
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
    
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    poly.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }

  return poly;
}

module.exports = {
  geocodeAddress,
  reverseGeocode,
  decodePolyline
};
