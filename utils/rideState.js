// rideState.js - In-memory ride request storage

// Store active ride requests
// Key: rideId, Value: { consumerId, driverId, status, etc. }
const pendingRideRequests = new Map();

module.exports = {
  pendingRideRequests
};
