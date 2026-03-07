// rideController.js - All ride operations and profile management

const db = require("../db");
const { RIDE_REQUEST_TIMEOUT, MAX_SEARCH_RADIUS_KM } = require("../config/constants");
const { pendingRideRequests } = require("../utils/rideState");
const { calculateDistance, calculateFare } = require("../utils/distance");
const { generateGeohash, getNeighboringGeohashes } = require("../utils/geohash");
const { generateOTP, getExpiryTimestamp } = require("../utils/otp");

// Find nearby available drivers using geohash
const findDrivers = async (req, res) => {
  const { pickupLocation } = req.body;
  const consumerId = req.user.id;

  if (req.user.role !== "Consumer") {
    return res.status(403).json({ error: "Only consumers can search for drivers" });
  }

  if (!pickupLocation?.latitude || !pickupLocation?.longitude) {
    return res.status(400).json({ error: "Pickup location is required" });
  }

  try {
    const userLat = parseFloat(pickupLocation.latitude);
    const userLon = parseFloat(pickupLocation.longitude);
    
    // Get primary geohash and neighboring geohashes
    const primaryGeohash = generateGeohash(userLat, userLon);
    const neighboringGeohashes = getNeighboringGeohashes(userLat, userLon);
    const allGeohashes = [primaryGeohash, ...neighboringGeohashes];
    
    console.log(`🔍 Searching for drivers in geohashes: ${allGeohashes.join(', ')}`);

    // Build geohash query - use LIKE to match geohash prefixes
    const geohashPlaceholders = allGeohashes.map((_, i) => `dl.geohash LIKE $${i + 1}`).join(' OR ');
    const geohashParams = allGeohashes.map(hash => `${hash}%`);

    const query = `
      SELECT 
        d.id, d.full_name, d.phone, d.scooter_model, d.profile_photo,
        dl.latitude, dl.longitude, dl.address, dl.updated_at, dl.geohash,
        CASE 
          WHEN dl.geohash LIKE $1 THEN 1
          ELSE 2
        END as priority
      FROM drivers d
      INNER JOIN driver_locations dl ON d.id = dl.user_id
      WHERE d.is_available = true
      AND dl.updated_at > NOW() - INTERVAL '30 minutes'
      AND (${geohashPlaceholders})
      ORDER BY priority ASC, dl.updated_at DESC
      LIMIT 10
    `;

    const result = await db.query(query, geohashParams);
    const drivers = result.rows;

    console.log(`📊 Database returned ${drivers.length} drivers before distance filtering`);
    if (drivers.length > 0) {
      drivers.forEach(d => {
        console.log(`   - Driver ${d.id} (${d.full_name}): geohash=${d.geohash}, lat=${d.latitude}, lon=${d.longitude}`);
      });
    }

    const driversWithDistance = drivers
      .map(driver => {
        const driverLat = parseFloat(driver.latitude);
        const driverLon = parseFloat(driver.longitude);
        const distance = calculateDistance(userLat, userLon, driverLat, driverLon);

        return {
          id: driver.id,
          fullName: driver.full_name,
          phone: driver.phone,
          scooterModel: driver.scooter_model,
          profilePhoto: driver.profile_photo,
          location: {
            latitude: driverLat,
            longitude: driverLon,
            address: driver.address
          },
          distanceFromPickup: Math.round(distance * 100) / 100,
          lastSeen: driver.updated_at,
          geohash: driver.geohash,
          priority: driver.priority
        };
      });

    // Log drivers before distance filtering
    console.log(`📏 Applying ${MAX_SEARCH_RADIUS_KM}km distance filter...`);
    driversWithDistance.forEach(d => {
      const withinRadius = d.distanceFromPickup <= MAX_SEARCH_RADIUS_KM;
      console.log(`   ${withinRadius ? '✓' : '✗'} Driver ${d.id} (${d.fullName}): ${d.distanceFromPickup}km ${withinRadius ? '' : `- TOO FAR (>${MAX_SEARCH_RADIUS_KM}km)`}`);
    });

    const filteredDrivers = driversWithDistance
      .filter(driver => driver.distanceFromPickup <= MAX_SEARCH_RADIUS_KM)
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.distanceFromPickup - b.distanceFromPickup;
      })
      .slice(0, 3);

    console.log(`\n🚗 === GEOHASH DRIVER SEARCH ===`);
    console.log(`📍 Pickup Location: ${userLat.toFixed(4)}, ${userLon.toFixed(4)}`);
    console.log(`🗺️ Primary Geohash: ${primaryGeohash}`);
    console.log(`� Search Radius: ${MAX_SEARCH_RADIUS_KM} km`);
    console.log(`👥 Available Drivers Found: ${filteredDrivers.length}\n`);
    
    filteredDrivers.forEach((driver, index) => {
      console.log(`${index + 1}. Driver ID: ${driver.id} | Name: ${driver.fullName}`);
      console.log(`   Distance: ${driver.distanceFromPickup} km | Geohash: ${driver.geohash}`);
      console.log(`   Priority: ${driver.priority === 1 ? 'Primary' : 'Neighbor'}\n`);
    });

    if (filteredDrivers.length === 0) {
      console.log("❌ No available drivers found in nearby geohashes\n");
    }

    res.json({
      success: true,
      drivers: filteredDrivers,
      totalFound: filteredDrivers.length,
      searchRadius: MAX_SEARCH_RADIUS_KM,
      geohash: primaryGeohash,
      searchMethod: 'geohash'
    });
  } catch (error) {
    console.error("Find drivers error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Create ride request with driver queue
const requestRide = async (req, res) => {
  const { pickupLocation, dropLocation, pickupAddress, dropAddress, driverQueue } = req.body;
  const consumerId = req.user.id;

  if (req.user.role !== "Consumer") {
    return res.status(403).json({ error: "Only consumers can request rides" });
  }

  if (!pickupLocation || !dropLocation || !driverQueue || driverQueue.length === 0) {
    return res.status(400).json({ error: "Invalid ride request data" });
  }

  try {
    const distance = calculateDistance(
      pickupLocation.latitude, pickupLocation.longitude,
      dropLocation.latitude, dropLocation.longitude
    );
    const fare = calculateFare(distance);

    const rideQuery = `
      INSERT INTO rides (
        consumer_id, pickup_latitude, pickup_longitude, pickup_address,
        drop_latitude, drop_longitude, drop_address, distance_km, fare,
        status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW())
      RETURNING id
    `;

    const rideResult = await db.query(rideQuery, [
      consumerId,
      pickupLocation.latitude, pickupLocation.longitude, pickupAddress,
      dropLocation.latitude, dropLocation.longitude, dropAddress,
      distance, fare
    ]);

    const rideId = rideResult.rows[0].id;

    const rideRequest = {
      rideId,
      consumerId,
      pickupLocation,
      dropLocation,
      pickupAddress,
      dropAddress,
      distance,
      fare,
      driverQueue: [...driverQueue],
      currentDriverIndex: 0,
      status: 'searching',
      createdAt: new Date().toISOString()
    };

    pendingRideRequests.set(rideId, rideRequest);

    console.log(`\n🎯 === RIDE REQUEST CREATED ===`);
    console.log(`Ride ID: ${rideId}`);
    console.log(`Consumer ID: ${consumerId}`);
    console.log(`Distance: ${distance.toFixed(2)} km`);
    console.log(`Fare: ₹${fare}`);
    console.log(`Driver Queue: [${driverQueue.map(d => d.id).join(', ')}]`);
    console.log(`Requesting Driver #1: ID ${driverQueue[0].id} (${driverQueue[0].fullName})\n`);

    startDriverTimeout(rideId);

    res.status(201).json({
      success: true,
      rideId,
      ride: {
        id: rideId,
        pickupLocation,
        dropLocation,
        pickupAddress,
        dropAddress,
        distance: Math.round(distance * 100) / 100,
        fare,
        status: 'searching',
        currentDriver: driverQueue[0],
        queuePosition: 1,
        totalDrivers: driverQueue.length
      }
    });
  } catch (error) {
    console.error("Ride request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Helper: Start driver timeout
function startDriverTimeout(rideId) {
  setTimeout(() => {
    const rideRequest = pendingRideRequests.get(rideId);
    
    if (!rideRequest || rideRequest.status !== 'searching') {
      return;
    }

    console.log(`\n⏰ === DRIVER TIMEOUT ===`);
    console.log(`Ride ID: ${rideId}`);
    console.log(`Driver ${rideRequest.driverQueue[rideRequest.currentDriverIndex].id} did not respond\n`);

    moveToNextDriver(rideId);
  }, RIDE_REQUEST_TIMEOUT);
}

// Helper: Move to next driver in queue
async function moveToNextDriver(rideId) {
  const rideRequest = pendingRideRequests.get(rideId);
  
  if (!rideRequest) return;

  rideRequest.currentDriverIndex++;

  if (rideRequest.currentDriverIndex >= rideRequest.driverQueue.length) {
    console.log(`\n❌ === NO DRIVERS AVAILABLE ===`);
    console.log(`Ride ID: ${rideId} - All drivers exhausted\n`);
    
    rideRequest.status = 'no_drivers';
    
    await db.query(
      "UPDATE rides SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
      [rideId]
    );
    
    return;
  }

  const nextDriver = rideRequest.driverQueue[rideRequest.currentDriverIndex];
  console.log(`\n➡️ === MOVING TO NEXT DRIVER ===`);
  console.log(`Ride ID: ${rideId}`);
  console.log(`Next Driver: #${rideRequest.currentDriverIndex + 1} - ID ${nextDriver.id} (${nextDriver.fullName})\n`);

  startDriverTimeout(rideId);
}

// Get pending rides for driver
const getPendingRides = (req, res) => {
  const driverId = req.user.id;

  if (req.user.role !== "Driver") {
    return res.status(403).json({ error: "Only drivers can view pending rides" });
  }

  const pendingRides = [];

  for (const [rideId, rideRequest] of pendingRideRequests.entries()) {
    if (rideRequest.status === 'searching') {
      const currentDriver = rideRequest.driverQueue[rideRequest.currentDriverIndex];
      
      if (currentDriver.id === driverId) {
        const distanceToPickup = currentDriver.distanceFromPickup;

        pendingRides.push({
          rideId,
          pickupLocation: rideRequest.pickupLocation,
          dropLocation: rideRequest.dropLocation,
          pickupAddress: rideRequest.pickupAddress,
          dropAddress: rideRequest.dropAddress,
          distanceToPickup: Math.round(distanceToPickup * 100) / 100,
          totalDistance: Math.round(rideRequest.distance * 100) / 100,
          fare: rideRequest.fare,
          queuePosition: rideRequest.currentDriverIndex + 1,
          createdAt: rideRequest.createdAt
        });
      }
    }
  }

  res.json({
    success: true,
    pendingRides,
    count: pendingRides.length
  });
};

// Accept ride
const acceptRide = async (req, res) => {
  const { rideId } = req.params;
  const driverId = req.user.id;

  if (req.user.role !== "Driver") {
    return res.status(403).json({ error: "Only drivers can accept rides" });
  }

  const rideRequest = pendingRideRequests.get(parseInt(rideId));

  if (!rideRequest) {
    return res.status(404).json({ error: "Ride request not found or expired" });
  }

  if (rideRequest.status !== 'searching') {
    return res.status(400).json({ error: "Ride is no longer available" });
  }

  const currentDriver = rideRequest.driverQueue[rideRequest.currentDriverIndex];

  if (currentDriver.id !== driverId) {
    return res.status(403).json({ error: "This ride is not assigned to you" });
  }

  const updateQuery = `
    UPDATE rides 
    SET driver_id = $1, status = 'accepted', accepted_at = NOW() 
    WHERE id = $2 AND status = 'pending'
  `;

  try {
    const result = await db.query(updateQuery, [driverId, rideId]);

    if (result.rowCount === 0) {
      return res.status(409).json({ error: "Ride was already accepted" });
    }

    // Generate pickup OTP for consumer to verify driver
    const pickupOTP = generateOTP();
    const expiresAt = getExpiryTimestamp();
    
    await db.query(
      `INSERT INTO ride_otp_verifications (ride_id, otp_type, otp_code, expires_at) 
       VALUES ($1, $2, $3, $4)`,
      [rideId, 'pickup', pickupOTP, expiresAt]
    );

    console.log(`🔐 Pickup OTP generated for ride ${rideId}`);

    rideRequest.status = 'accepted';
    rideRequest.acceptedDriverId = driverId;

    console.log(`\n✅ === RIDE ACCEPTED ===`);
    console.log(`Ride ID: ${rideId}`);
    console.log(`Driver ID: ${driverId} (${currentDriver.fullName})`);
    console.log(`Distance to Pickup: ${currentDriver.distanceFromPickup} km`);
    console.log(`Total Trip Distance: ${rideRequest.distance.toFixed(2)} km`);
    console.log(`Fare: ₹${rideRequest.fare}\n`);

    const locResult = await db.query(
      "SELECT latitude, longitude, address FROM driver_locations WHERE user_id = $1",
      [driverId]
    );
    const driverLocation = locResult.rows.length > 0 
      ? {
          latitude: parseFloat(locResult.rows[0].latitude),
          longitude: parseFloat(locResult.rows[0].longitude),
          address: locResult.rows[0].address
        }
      : currentDriver.location;

    const distanceToPickup = currentDriver.distanceFromPickup;
    const etaToPickupMinutes = Math.round((distanceToPickup / 25) * 60);

    res.json({
      success: true,
      message: "Ride accepted successfully",
      ride: {
        rideId: parseInt(rideId),
        driverLocation,
        pickupLocation: rideRequest.pickupLocation,
        dropLocation: rideRequest.dropLocation,
        pickupAddress: rideRequest.pickupAddress,
        dropAddress: rideRequest.dropAddress,
        distanceToPickup: Math.round(currentDriver.distanceFromPickup * 100) / 100,
        totalDistance: Math.round(rideRequest.distance * 100) / 100,
        fare: rideRequest.fare,
        etaToPickup: etaToPickupMinutes,
        status: 'accepted'
      }
    });
  } catch (error) {
    console.error("Accept ride error:", error);
    res.status(500).json({ error: "Failed to accept ride" });
  }
};

// Reject ride
const rejectRide = (req, res) => {
  const { rideId } = req.params;
  const driverId = req.user.id;

  if (req.user.role !== "Driver") {
    return res.status(403).json({ error: "Only drivers can reject rides" });
  }

  const rideRequest = pendingRideRequests.get(parseInt(rideId));

  if (!rideRequest || rideRequest.status !== 'searching') {
    return res.status(404).json({ error: "Ride request not found" });
  }

  const currentDriver = rideRequest.driverQueue[rideRequest.currentDriverIndex];

  if (currentDriver.id !== driverId) {
    return res.status(403).json({ error: "This ride is not assigned to you" });
  }

  console.log(`\n❌ === RIDE REJECTED ===`);
  console.log(`Ride ID: ${rideId}`);
  console.log(`Driver ID: ${driverId} (${currentDriver.fullName})\n`);

  moveToNextDriver(parseInt(rideId));

  res.json({
    success: true,
    message: "Ride rejected, moving to next driver"
  });
};

// Get ride status
const getRideStatus = async (req, res) => {
  const { rideId } = req.params;
  const userId = req.user.id;

  const rideRequest = pendingRideRequests.get(parseInt(rideId));

  if (!rideRequest) {
    try {
      const result = await db.query("SELECT * FROM rides WHERE id = $1", [rideId]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Ride not found" });
      }

      const ride = result.rows[0];
      res.json({
        success: true,
        status: ride.status,
        rideId: parseInt(rideId),
        driverId: ride.driver_id
      });
    } catch (error) {
      console.error("Get ride status error:", error);
      res.status(500).json({ error: "Failed to fetch ride status" });
    }
    return;
  }

  if (rideRequest.consumerId !== userId && req.user.role === 'Consumer') {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const currentDriver = rideRequest.driverQueue[rideRequest.currentDriverIndex];

  res.json({
    success: true,
    status: rideRequest.status,
    rideId: parseInt(rideId),
    currentDriver: rideRequest.status === 'searching' ? {
      id: currentDriver.id,
      name: currentDriver.fullName,
      queuePosition: rideRequest.currentDriverIndex + 1,
      totalDrivers: rideRequest.driverQueue.length
    } : null,
    acceptedDriverId: rideRequest.acceptedDriverId || null
  });
};

// Get active ride
const getActiveRide = async (req, res) => {
  const { id, role } = req.user;

  const query = role === "Consumer"
    ? `
      SELECT 
        r.*, 
        d.full_name as driver_name, 
        d.phone as driver_phone, 
        d.scooter_model,
        d.profile_photo as driver_photo,
        dl.latitude as driver_latitude,
        dl.longitude as driver_longitude
      FROM rides r
      LEFT JOIN drivers d ON r.driver_id = d.id
      LEFT JOIN driver_locations dl ON d.id = dl.user_id
      WHERE r.consumer_id = $1 
      AND r.status IN ('accepted', 'in_progress')
      ORDER BY r.created_at DESC
      LIMIT 1
    `
    : `
      SELECT 
        r.*, 
        c.full_name as consumer_name, 
        c.phone as consumer_phone
      FROM rides r
      LEFT JOIN consumers c ON r.consumer_id = c.id
      WHERE r.driver_id = $1 
      AND r.status IN ('accepted', 'in_progress')
      ORDER BY r.created_at DESC
      LIMIT 1
    `;

  try {
    const result = await db.query(query, [id]);

    if (result.rows.length === 0) {
      return res.json({ success: true, ride: null });
    }

    const ride = result.rows[0];
    
    const rideData = {
      id: ride.id,
      pickup: {
        latitude: parseFloat(ride.pickup_latitude),
        longitude: parseFloat(ride.pickup_longitude),
        address: ride.pickup_address
      },
      drop: {
        latitude: parseFloat(ride.drop_latitude),
        longitude: parseFloat(ride.drop_longitude),
        address: ride.drop_address
      },
      distance: parseFloat(ride.distance_km),
      fare: parseFloat(ride.fare),
      status: ride.status,
      createdAt: ride.created_at,
      acceptedAt: ride.accepted_at,
      startedAt: ride.started_at,
    };

    if (role === "Consumer") {
      rideData.driver = ride.driver_id ? {
        id: ride.driver_id,
        name: ride.driver_name,
        phone: ride.driver_phone,
        scooterModel: ride.scooter_model,
        profilePhoto: ride.driver_photo,
        location: ride.driver_latitude && ride.driver_longitude ? {
          latitude: parseFloat(ride.driver_latitude),
          longitude: parseFloat(ride.driver_longitude),
        } : null
      } : null;
    } else {
      rideData.consumer = {
        name: ride.consumer_name,
        phone: ride.consumer_phone
      };
    }

    res.json({
      success: true,
      ride: rideData
    });
  } catch (err) {
    console.error("Get active ride error:", err);
    return res.status(500).json({ error: "Failed to fetch active ride" });
  }
};

// Get ride history
const getRideHistory = async (req, res) => {
  const { id, role } = req.user;
  const { page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  let query, params;

  if (role === "Consumer") {
    query = `
      SELECT 
        r.*, d.full_name as driver_name, d.phone as driver_phone, d.scooter_model
      FROM rides r
      LEFT JOIN drivers d ON r.driver_id = d.id
      WHERE r.consumer_id = $1 AND r.status = 'completed'
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    params = [id, parseInt(limit), parseInt(offset)];
  } else {
    query = `
      SELECT 
        r.*, c.full_name as consumer_name, c.phone as consumer_phone
      FROM rides r
      LEFT JOIN consumers c ON r.consumer_id = c.id
      WHERE r.driver_id = $1 AND r.status = 'completed'
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
    `;
    params = [id, parseInt(limit), parseInt(offset)];
  }

  try {
    const result = await db.query(query, params);

    const rides = result.rows.map(ride => ({
      id: ride.id,
      pickup: {
        latitude: parseFloat(ride.pickup_latitude),
        longitude: parseFloat(ride.pickup_longitude),
        address: ride.pickup_address
      },
      drop: {
        latitude: parseFloat(ride.drop_latitude),
        longitude: parseFloat(ride.drop_longitude),
        address: ride.drop_address
      },
      distance: parseFloat(ride.distance_km),
      fare: ride.fare,
      status: ride.status,
      createdAt: ride.created_at,
      startedAt: ride.started_at,
      completedAt: ride.completed_at,
      ...(role === "Consumer" ? {
        driver: ride.driver_id ? {
          name: ride.driver_name,
          phone: ride.driver_phone,
          scooterModel: ride.scooter_model
        } : null
      } : {
        consumer: {
          name: ride.consumer_name,
          phone: ride.consumer_phone
        }
      })
    }));

    res.json({
      rides,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: rides.length
      }
    });
  } catch (err) {
    console.error("Ride history error:", err);
    return res.status(500).json({ error: "Failed to fetch ride history" });
  }
};

// Start ride
const startRide = async (req, res) => {
  const { rideId } = req.params;
  const driverId = req.user.id;

  if (req.user.role !== "Driver") {
    return res.status(403).json({ error: "Only drivers can start rides" });
  }

  try {
    // Check if pickup OTP was verified
    const otpCheck = await db.query(
      `SELECT verified FROM ride_otp_verifications 
       WHERE ride_id = $1 AND otp_type = 'pickup'`,
      [rideId]
    );

    if (otpCheck.rows.length === 0) {
      return res.status(400).json({ error: "Pickup OTP not found" });
    }

    if (!otpCheck.rows[0].verified) {
      return res.status(403).json({ 
        error: "Cannot start ride. Consumer must verify pickup OTP first." 
      });
    }

    const updateQuery = `
      UPDATE rides 
      SET status = 'in_progress', started_at = NOW() 
      WHERE id = $1 AND driver_id = $2 AND status = 'accepted'
    `;

    const result = await db.query(updateQuery, [rideId, driverId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Ride not found or cannot be started" });
    }

    // Generate drop OTP immediately when ride starts
    const dropOTP = generateOTP();
    const expiresAt = getExpiryTimestamp();
    
    await db.query(
      `INSERT INTO ride_otp_verifications (ride_id, otp_type, otp_code, expires_at) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (ride_id, otp_type) 
       DO UPDATE SET otp_code = $3, expires_at = $4, verified = false, attempts = 0, locked = false`,
      [rideId, 'drop', dropOTP, expiresAt]
    );

    console.log(`🔐 Drop OTP generated for ride ${rideId}`);
    console.log(`✅ Ride ${rideId} started.`);

    res.json({
      message: "Ride started successfully.",
      rideId: parseInt(rideId)
    });
  } catch (error) {
    console.error("Start ride error:", error);
    res.status(500).json({ error: "Failed to start ride" });
  }
};

// Cancel ride
const cancelRide = async (req, res) => {
  const { rideId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // Check if user is authorized for this ride
    const rideCheck = await db.query(
      `SELECT consumer_id, driver_id, status FROM rides WHERE id = $1`,
      [rideId]
    );

    if (rideCheck.rows.length === 0) {
      return res.status(404).json({ error: "Ride not found" });
    }

    const ride = rideCheck.rows[0];

    // Only consumer or driver can cancel
    if (userRole === 'Consumer' && ride.consumer_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    if (userRole === 'Driver' && ride.driver_id !== userId) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Can only cancel if status is pending or accepted
    if (!['pending', 'accepted'].includes(ride.status)) {
      return res.status(400).json({ error: "Cannot cancel ride in current status" });
    }

    const updateQuery = `
      UPDATE rides 
      SET status = 'cancelled', completed_at = NOW() 
      WHERE id = $1
    `;

    await db.query(updateQuery, [rideId]);

    console.log(`🚫 Ride ${rideId} cancelled by ${userRole} ${userId}`);

    res.json({
      message: "Ride cancelled successfully",
      rideId: parseInt(rideId)
    });
  } catch (error) {
    console.error("Cancel ride error:", error);
    res.status(500).json({ error: "Failed to cancel ride" });
  }
};

// Complete ride
const completeRide = async (req, res) => {
  const { rideId } = req.params;
  const driverId = req.user.id;

  if (req.user.role !== "Driver") {
    return res.status(403).json({ error: "Only drivers can complete rides" });
  }

  try {
    // Check if drop OTP was verified
    const otpCheck = await db.query(
      `SELECT verified FROM ride_otp_verifications 
       WHERE ride_id = $1 AND otp_type = 'drop'`,
      [rideId]
    );

    if (otpCheck.rows.length === 0) {
      return res.status(400).json({ error: "Drop OTP not found" });
    }

    if (!otpCheck.rows[0].verified) {
      return res.status(403).json({ 
        error: "Cannot complete ride. Driver must verify drop OTP first." 
      });
    }

    const updateQuery = `
      UPDATE rides 
      SET status = 'completed', completed_at = NOW() 
      WHERE id = $1 AND driver_id = $2 AND status = 'in_progress'
    `;

    const result = await db.query(updateQuery, [rideId, driverId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Ride not found or cannot be completed" });
    }

    res.json({
      message: "Ride completed successfully",
      rideId: parseInt(rideId)
    });
  } catch (error) {
    console.error("Complete ride error:", error);
    res.status(500).json({ error: "Failed to complete ride" });
  }
};

// ===== PROFILE Management =====

// Get user profile
const getProfile = async (req, res) => {
  const { role, id } = req.params;
  if (!["Consumer", "Driver"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  if (req.user.role !== role || req.user.id != id) {
    return res.status(403).json({ error: "Unauthorized access" });
  }

  const table = role === "Consumer" ? "consumers" : "drivers";
  const query = `SELECT * FROM ${table} WHERE id = $1`;

  try {
    const result = await db.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];
    const safeUser = {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      phone: user.phone,
      gender: user.gender,
      dateOfBirth: user.date_of_birth,
      address: user.address,
      profilePhoto: user.profile_photo,
      role,
    };

    res.json({ user: safeUser });
  } catch (error) {
    console.error("Fetch profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

// Update driver availability
const updateDriverAvailability = async (req, res) => {
  const { id } = req.params;
  const { isAvailable } = req.body;

  if (req.user.role !== "Driver" || req.user.id != id) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  const query = "UPDATE drivers SET is_available = $1 WHERE id = $2";
  try {
    await db.query(query, [isAvailable, id]);
    res.json({ message: "Availability updated successfully", isAvailable });
  } catch (error) {
    console.error("Update availability error:", error);
    res.status(500).json({ error: "Failed to update availability" });
  }
};

// Get driver profile
const getDriverProfile = async (req, res) => {
  console.log("Decoded JWT:", req.user);

  if (req.user.role !== "Driver") {
    return res.status(403).json({ error: "Access denied. Not a driver account" });
  }

  const query = `SELECT * FROM drivers WHERE id = $1`;
  console.log("Fetching driver with ID:", req.user.id);

  try {
    const result = await db.query(query, [req.user.id]);

    if (result.rows.length === 0) {
      console.log("No driver found with ID:", req.user.id);
      return res.status(404).json({ error: "Driver not found" });
    }

    const driver = result.rows[0];
    res.json({
      id: driver.id,
      fullName: driver.full_name,
      email: driver.email,
      phone: driver.phone,
      gender: driver.gender,
      dateOfBirth: driver.date_of_birth,
      address: driver.address,
      aadharNumber: driver.aadhar_number,
      licenseNumber: driver.license_number,
      scooterModel: driver.scooter_model,
      profilePhoto: driver.profile_photo,
      isAvailable: driver.is_available,
      role: "Driver",
    });
  } catch (error) {
    console.error("DB Error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

module.exports = {
  findDrivers,
  requestRide,
  getPendingRides,
  acceptRide,
  rejectRide,
  getRideStatus,
  getActiveRide,
  getRideHistory,
  startRide,
  cancelRide,
  completeRide,
  getProfile,
  updateDriverAvailability,
  getDriverProfile,
};
