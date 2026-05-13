// rideState.js - In-memory ride request storage

// Store active ride requests
// Key: rideId, Value: { consumerId, driverId, status, etc. }
const pendingRideRequests = new Map();

// Store active driver locks while ride search is in progress
// Key: driverId, Value: { rideId, consumerId, distanceFromPickup, lockedAt }
const driverRequestLocks = new Map();

module.exports = {
  pendingRideRequests,
  driverRequestLocks
};
