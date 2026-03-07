// mapsController.js - Google Maps API integrations

const axios = require("axios");
const { GOOGLE_MAPS_API_KEY } = require("../config/constants");
const { geocodeAddress, reverseGeocode, decodePolyline } = require("../utils/geocoding");

// Geocode address to coordinates
const geocode = async (req, res) => {
  const { address } = req.body;

  if (!address || !address.trim()) {
    return res.status(400).json({ error: "Address is required" });
  }

  try {
    const result = await geocodeAddress(address.trim());
    
    res.json({
      success: true,
      address: address.trim(),
      coordinates: {
        latitude: result.lat,
        longitude: result.lng
      },
      formatted_address: result.formatted_address,
      place_id: result.place_id,
      types: result.types
    });
  } catch (error) {
    console.error("Geocoding error:", error.message);
    
    res.status(400).json({ 
      success: false,
      error: error.message || "Failed to geocode address",
      address: address.trim()
    });
  }
};

// Reverse geocode coordinates to address
const reverseGeocodeFn = async (req, res) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: "Latitude and longitude are required" });
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  try {
    const result = await reverseGeocode(latitude, longitude);

    res.json({
      success: true,
      coordinates: { 
        latitude: parseFloat(latitude), 
        longitude: parseFloat(longitude) 
      },
      formatted_address: result.formatted_address,
      place_id: result.place_id,
      address_components: result.address_components,
      types: result.types
    });
  } catch (error) {
    console.error("Reverse geocoding error:", error.message);
    
    res.json({
      success: false,
      coordinates: { 
        latitude: parseFloat(latitude), 
        longitude: parseFloat(longitude) 
      },
      formatted_address: `Location near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      place_id: null,
      error: error.message
    });
  }
};

// Get directions between two locations
const getDirections = async (req, res) => {
  const { origin, destination } = req.body;

  if (!origin || !destination) {
    return res.status(400).json({ error: "Origin and destination are required" });
  }

  try {
    const originEncoded = encodeURIComponent(origin.trim());
    const destinationEncoded = encodeURIComponent(destination.trim());
    
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originEncoded}&destination=${destinationEncoded}&key=${GOOGLE_MAPS_API_KEY}&mode=driving`;
    
    console.log(`🗺️ Getting directions from "${origin}" to "${destination}"`);
    
    const response = await axios.get(url);
    
    if (response.data.status === 'OK' && response.data.routes.length > 0) {
      const route = response.data.routes[0];
      const leg = route.legs[0];
      
      const points = decodePolyline(route.overview_polyline.points);
      
      res.json({
        success: true,
        route: {
          coordinates: points,
          distance: leg.distance.text,
          duration: leg.duration.text,
          distanceValue: leg.distance.value,
          durationValue: leg.duration.value,
          startAddress: leg.start_address,
          endAddress: leg.end_address,
          startLocation: leg.start_location,
          endLocation: leg.end_location,
        }
      });
    } else if (response.data.status === 'ZERO_RESULTS') {
      res.status(404).json({
        success: false,
        error: 'No route found between these locations'
      });
    } else {
      console.error(`❌ Directions API error: ${response.data.status}`);
      res.status(400).json({
        success: false,
        error: `Failed to get directions: ${response.data.status}`
      });
    }
  } catch (error) {
    console.error('Directions API error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch directions'
    });
  }
};

// Places autocomplete search
const placeAutocomplete = async (req, res) => {
  const { input, location, radius = 50000 } = req.body;

  if (!input || !input.trim()) {
    return res.status(400).json({ error: "Search input is required" });
  }

  try {
    let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input.trim())}&key=${GOOGLE_MAPS_API_KEY}`;
    
    if (location && location.latitude && location.longitude) {
      url += `&location=${location.latitude},${location.longitude}&radius=${radius}`;
    }
    
    url += '&components=country:in';
    
    console.log(`🔍 Places autocomplete for: "${input}"`);
    
    const response = await axios.get(url);
    
    if (response.data.status === 'OK') {
      const suggestions = response.data.predictions.map(prediction => ({
        place_id: prediction.place_id,
        description: prediction.description,
        main_text: prediction.structured_formatting.main_text,
        secondary_text: prediction.structured_formatting.secondary_text,
        types: prediction.types
      }));

      res.json({
        success: true,
        suggestions,
        status: response.data.status
      });
    } else {
      console.warn(`⚠️ Places API warning: ${response.data.status}`);
      res.json({
        success: false,
        suggestions: [],
        status: response.data.status,
        error: response.data.error_message || 'No suggestions found'
      });
    }
  } catch (error) {
    console.error('Places autocomplete error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch place suggestions',
      suggestions: []
    });
  }
};

// Get place details by place_id
const placeDetails = async (req, res) => {
  const { place_id } = req.body;

  if (!place_id) {
    return res.status(400).json({ error: "Place ID is required" });
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=geometry,formatted_address,name,types&key=${GOOGLE_MAPS_API_KEY}`;
    
    console.log(`📍 Getting place details for: ${place_id}`);
    
    const response = await axios.get(url);
    
    if (response.data.status === 'OK') {
      const place = response.data.result;
      
      res.json({
        success: true,
        place_id: place_id,
        name: place.name,
        formatted_address: place.formatted_address,
        coordinates: {
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng
        },
        types: place.types
      });
    } else {
      console.error(`❌ Place details API error: ${response.data.status}`);
      res.status(400).json({
        success: false,
        error: `Failed to get place details: ${response.data.status}`,
        place_id: place_id
      });
    }
  } catch (error) {
    console.error('Place details error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch place details'
    });
  }
};

module.exports = {
  geocode,
  reverseGeocode: reverseGeocodeFn,
  getDirections,
  placeAutocomplete,
  placeDetails,
};
