// rideController.js - All ride operations and profile management

const db = require("../db");
const { RIDE_REQUEST_TIMEOUT, MAX_DRIVERS_TO_RETURN } = require("../config/constants");
const { pendingRideRequests, driverRequestLocks } = require("../utils/rideState");
const { calculateDistance, calculateFare } = require("../utils/distance");
const { generateGeohash, getNeighboringGeohashes } = require("../utils/geohash");
const { generateOTP, getExpiryTimestamp } = require("../utils/otp");
const { emitRideStageChanged } = require('../realtime/socketServer');
const { saveRideSafetyContacts, getRideSafetyContacts } = require('../utils/safetyContacts');
const { generateTrackToken, expireTokensForRide } = require('../utils/liveTrack');
const { sendRideAcceptedNotification, sendLiveTrackNotification } = require('../utils/whatsapp');
const BACKEND_URL = process.env.BACKEND_URL || 'https://soberfolks-backend.onrender.com';

const SEARCH_RADIUS_STEPS_KM = [1.5, 3, 9];
const DRIVER_LOCK_STALE_AFTER_MS = RIDE_REQUEST_TIMEOUT * 2;

async function fetchCandidateDrivers(pickupLocation, consumerId) {
  const userLat = parseFloat(pickupLocation.latitude);
  const userLon = parseFloat(pickupLocation.longitude);

  const primaryGeohash = generateGeohash(userLat, userLon, 5);
  const neighboringGeohashes = getNeighboringGeohashes(userLat, userLon);
  const allGeohashes = Array.from(new Set([primaryGeohash, ...neighboringGeohashes]));

  const query = `
    SELECT
      d.id, d.full_name, d.phone, d.scooter_model, d.profile_photo,
      dl.latitude, dl.longitude, dl.address, dl.updated_at, dl.geohash
    FROM drivers d
    INNER JOIN driver_locations dl ON d.id = dl.user_id
    LEFT JOIN rides ar
      ON ar.driver_id = d.id
      AND ar.status IN ('accepted', 'in_progress')
    WHERE d.is_available = true
      AND ar.id IS NULL
      AND dl.updated_at > NOW() - INTERVAL '30 minutes'
      AND LEFT(dl.geohash, 5) = ANY($1::text[])
  `;

  const result = await db.query(query, [allGeohashes]);

  return result.rows
    .map((driver) => {
      const driverLat = parseFloat(driver.latitude);
      const driverLon = parseFloat(driver.longitude);
      const distanceFromPickup = calculateDistance(userLat, userLon, driverLat, driverLon);

      return {
        id: driver.id,
        fullName: driver.full_name,
        phone: driver.phone,
        scooterModel: driver.scooter_model,
        profilePhoto: driver.profile_photo,
        location: {
          latitude: driverLat,
          longitude: driverLon,
          address: driver.address,
        },
        distanceFromPickup: Math.round(distanceFromPickup * 100) / 100,
        lastSeen: driver.updated_at,
        geohash: driver.geohash,
      };
    })
    .filter((driver) => {
      if (driver.distanceFromPickup > SEARCH_RADIUS_STEPS_KM[SEARCH_RADIUS_STEPS_KM.length - 1]) {
        return false;
      }

      const lock = driverRequestLocks.get(driver.id);
      if (!lock) {
        return true;
      }

      if (Date.now() - lock.lockedAt > DRIVER_LOCK_STALE_AFTER_MS) {
        driverRequestLocks.delete(driver.id);
        return true;
      }

      const lockedRide = pendingRideRequests.get(lock.rideId);
      if (!lockedRide || lockedRide.status !== "searching") {
        driverRequestLocks.delete(driver.id);
        return true;
      }

      return lock.consumerId === consumerId;
    })
    .sort((a, b) => a.distanceFromPickup - b.distanceFromPickup);
}

function buildStagedDriverQueue(drivers) {
  const [r1, r2, r3] = SEARCH_RADIUS_STEPS_KM;

  const stage1 = drivers.filter((driver) => driver.distanceFromPickup <= r1);
  const stage2 = drivers.filter(
    (driver) => driver.distanceFromPickup > r1 && driver.distanceFromPickup <= r2
  );
  const stage3 = drivers.filter(
    (driver) => driver.distanceFromPickup > r2 && driver.distanceFromPickup <= r3
  );

  const queue = [...stage1, ...stage2, ...stage3].slice(0, MAX_DRIVERS_TO_RETURN);

  return {
    queue,
    stageBreakdown: {
      within1_5km: stage1.length,
      within3km: stage1.length + stage2.length,
      within9km: stage1.length + stage2.length + stage3.length,
    },
  };
}

function releaseDriverLock(driverId, rideId = null) {
  const lock = driverRequestLocks.get(driverId);
  if (!lock) {
    return;
  }

  if (rideId === null || lock.rideId === rideId) {
    driverRequestLocks.delete(driverId);
  }
}

async function tryLockDriverForRide(rideRequest, driver) {
  const existingLock = driverRequestLocks.get(driver.id);

  if (!existingLock) {
    driverRequestLocks.set(driver.id, {
      rideId: rideRequest.rideId,
      consumerId: rideRequest.consumerId,
      distanceFromPickup: driver.distanceFromPickup,
      lockedAt: Date.now(),
    });
    return true;
  }

  if (Date.now() - existingLock.lockedAt > DRIVER_LOCK_STALE_AFTER_MS) {
    releaseDriverLock(driver.id, existingLock.rideId);
    driverRequestLocks.set(driver.id, {
      rideId: rideRequest.rideId,
      consumerId: rideRequest.consumerId,
      distanceFromPickup: driver.distanceFromPickup,
      lockedAt: Date.now(),
    });
    return true;
  }

  if (existingLock.rideId === rideRequest.rideId) {
    return true;
  }

  const existingRide = pendingRideRequests.get(existingLock.rideId);
  if (!existingRide || existingRide.status !== "searching") {
    releaseDriverLock(driver.id, existingLock.rideId);
    driverRequestLocks.set(driver.id, {
      rideId: rideRequest.rideId,
      consumerId: rideRequest.consumerId,
      distanceFromPickup: driver.distanceFromPickup,
      lockedAt: Date.now(),
    });
    return true;
  }

  if (driver.distanceFromPickup + 0.01 < existingLock.distanceFromPickup) {
    releaseDriverLock(driver.id, existingLock.rideId);
    await moveToNextDriver(existingRide.rideId, {
      skipReleaseCurrentLock: true,
      reason: "reassigned_to_closer_consumer",
    });

    driverRequestLocks.set(driver.id, {
      rideId: rideRequest.rideId,
      consumerId: rideRequest.consumerId,
      distanceFromPickup: driver.distanceFromPickup,
      lockedAt: Date.now(),
    });
    return true;
  }

  return false;
}

async function lockCurrentDriverOrAdvance(rideRequest) {
  while (rideRequest.currentDriverIndex < rideRequest.driverQueue.length) {
    const currentDriver = rideRequest.driverQueue[rideRequest.currentDriverIndex];
    const locked = await tryLockDriverForRide(rideRequest, currentDriver);
    if (locked) {
      return currentDriver;
    }
    rideRequest.currentDriverIndex += 1;
  }

  return null;
}

// Find nearby available drivers using staged geohash + distance search (1.5km -> 3km -> 9km)
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
    const primaryGeohash = generateGeohash(userLat, userLon, 5);

    const candidates = await fetchCandidateDrivers(pickupLocation, consumerId);
    const { queue, stageBreakdown } = buildStagedDriverQueue(candidates);

    console.log(`\n🚗 === STAGED GEOHASH DRIVER SEARCH ===`);
    console.log(`📍 Pickup Location: ${userLat.toFixed(4)}, ${userLon.toFixed(4)}`);
    console.log(`🗺️ Primary Geohash: ${primaryGeohash}`);
    console.log(`🔎 Stage 1 (<=1.5km): ${stageBreakdown.within1_5km}`);
    console.log(`🔎 Stage 2 (<=3km): ${stageBreakdown.within3km}`);
    console.log(`🔎 Stage 3 (<=9km): ${stageBreakdown.within9km}`);
    console.log(`👥 Queue Size Returned: ${queue.length}\n`);

    res.json({
      success: true,
      drivers: queue,
      totalFound: queue.length,
      searchRadiusStepsKm: SEARCH_RADIUS_STEPS_KM,
      geohash: primaryGeohash,
      stageBreakdown,
      searchMethod: "staged_geohash_radius",
    });
  } catch (error) {
    console.error("Find drivers error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Create ride request with server-side queue and lock-aware assignment
const requestRide = async (req, res) => {
  const { pickupLocation, dropLocation, pickupAddress, dropAddress, driverQueue } = req.body;
  const consumerId = req.user.id;

  if (req.user.role !== "Consumer") {
    return res.status(403).json({ error: "Only consumers can request rides" });
  }

  if (!pickupLocation || !dropLocation) {
    return res.status(400).json({ error: "Invalid ride request data" });
  }

  try {
    const distance = calculateDistance(
      pickupLocation.latitude, pickupLocation.longitude,
      dropLocation.latitude, dropLocation.longitude
    );
    const fare = calculateFare(distance);

    const computedQueue = buildStagedDriverQueue(
      await fetchCandidateDrivers(pickupLocation, consumerId)
    ).queue;

    const fallbackQueue = Array.isArray(driverQueue) ? driverQueue : [];
    const finalQueue = computedQueue.length > 0 ? computedQueue : fallbackQueue;

    if (finalQueue.length === 0) {
      return res.status(409).json({ error: "No drivers available at this time" });
    }

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

    // Persist safety contacts (optional — fire-and-forget, never blocks ride creation)
    const safetyContacts = Array.isArray(req.body.safetyContacts) ? req.body.safetyContacts : [];
    console.log(`🔖 [requestRide] safetyContacts received from mobile: ${safetyContacts.length}`, JSON.stringify(safetyContacts));
    if (safetyContacts.length > 0) {
      saveRideSafetyContacts(rideId, safetyContacts).catch(err =>
        console.warn('Safety contacts save failed (non-critical):', err.message)
      );
    }

    const rideRequest = {
      rideId,
      consumerId,
      pickupLocation,
      dropLocation,
      pickupAddress,
      dropAddress,
      distance,
      fare,
      driverQueue: [...finalQueue],
      currentDriverIndex: 0,
      status: 'searching',
      createdAt: new Date().toISOString()
    };

    pendingRideRequests.set(rideId, rideRequest);

    const lockedDriver = await lockCurrentDriverOrAdvance(rideRequest);

    if (!lockedDriver) {
      rideRequest.status = "no_drivers";
      await db.query(
        "UPDATE rides SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
        [rideId]
      );

      return res.status(409).json({ error: "No drivers available after lock allocation" });
    }

    console.log(`\n🎯 === RIDE REQUEST CREATED ===`);
    console.log(`Ride ID: ${rideId}`);
    console.log(`Consumer ID: ${consumerId}`);
    console.log(`Distance: ${distance.toFixed(2)} km`);
    console.log(`Fare: ₹${fare}`);
    console.log(`Driver Queue: [${finalQueue.map(d => d.id).join(', ')}]`);
    console.log(
      `Requesting Driver #${rideRequest.currentDriverIndex + 1}: ID ${lockedDriver.id} (${lockedDriver.fullName})\n`
    );

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
        currentDriver: lockedDriver,
        queuePosition: rideRequest.currentDriverIndex + 1,
        totalDrivers: rideRequest.driverQueue.length
      }
    });
  } catch (error) {
    console.error("Ride request error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Helper: Start driver timeout
function startDriverTimeout(rideId) {
  const rideRequest = pendingRideRequests.get(rideId);
  if (!rideRequest || rideRequest.status !== 'searching') {
    return;
  }

  const expectedDriver = rideRequest.driverQueue[rideRequest.currentDriverIndex];
  if (!expectedDriver) {
    return;
  }

  setTimeout(() => {
    const latestRideRequest = pendingRideRequests.get(rideId);

    if (!latestRideRequest || latestRideRequest.status !== 'searching') {
      return;
    }

    const currentDriver = latestRideRequest.driverQueue[latestRideRequest.currentDriverIndex];
    if (!currentDriver || currentDriver.id !== expectedDriver.id) {
      return;
    }

    console.log(`\n⏰ === DRIVER TIMEOUT ===`);
    console.log(`Ride ID: ${rideId}`);
    console.log(`Driver ${currentDriver.id} did not respond\n`);

    moveToNextDriver(rideId);
  }, RIDE_REQUEST_TIMEOUT);
}

// Helper: Move to next driver in queue
async function moveToNextDriver(rideId, options = {}) {
  const rideRequest = pendingRideRequests.get(rideId);
  
  if (!rideRequest) {
    return;
  }

  const previousDriver = rideRequest.driverQueue[rideRequest.currentDriverIndex];
  if (!options.skipReleaseCurrentLock && previousDriver) {
    releaseDriverLock(previousDriver.id, rideId);
  }

  rideRequest.currentDriverIndex++;

  const lockedDriver = await lockCurrentDriverOrAdvance(rideRequest);

  if (!lockedDriver) {
    console.log(`\n❌ === NO DRIVERS AVAILABLE ===`);
    console.log(`Ride ID: ${rideId} - All drivers exhausted\n`);
    
    rideRequest.status = 'no_drivers';
    
    await db.query(
      "UPDATE rides SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
      [rideId]
    );
    
    return;
  }

  console.log(`\n➡️ === MOVING TO NEXT DRIVER ===`);
  console.log(`Ride ID: ${rideId}`);
  console.log(
    `Next Driver: #${rideRequest.currentDriverIndex + 1} - ID ${lockedDriver.id} (${lockedDriver.fullName})`
  );
  if (options.reason) {
    console.log(`Reason: ${options.reason}`);
  }
  console.log("");

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
      
      if (currentDriver && currentDriver.id === driverId) {
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
    releaseDriverLock(driverId, parseInt(rideId));
    pendingRideRequests.delete(parseInt(rideId));

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

    emitRideStageChanged(parseInt(rideId), {
      stage: 'accepted',
      status: 'accepted',
      driverId,
      consumerId: rideRequest.consumerId,
      timestamp: new Date().toISOString(),
    });

    // Send WhatsApp ride-accepted notification to safety contacts (async, non-blocking)
    Promise.resolve().then(async () => {
      try {
        const contacts = await getRideSafetyContacts(parseInt(rideId));
        console.log(`🚗 [acceptRide] Safety contacts for ride ${rideId}: ${contacts.length}`);
        if (contacts.length === 0) {
          console.log('   No safety contacts found — WhatsApp notification skipped.');
          return;
        }

        // Fetch consumer name
        const consumerResult = await db.query(
          'SELECT full_name FROM consumers WHERE id = $1',
          [rideRequest.consumerId]
        );
        const consumerName = consumerResult.rows[0]?.full_name || 'Your contact';

        // Fetch driver vehicle number
        const driverResult = await db.query(
          'SELECT scooter_model FROM drivers WHERE id = $1',
          [driverId]
        );
        const vehicleNumber = driverResult.rows[0]?.scooter_model || 'N/A';

        await sendRideAcceptedNotification(contacts, {
          consumerName,
          driverName:    currentDriver.fullName,
          driverPhone:   currentDriver.phone || 'N/A',
          vehicleNumber,
          pickup:        rideRequest.pickupAddress,
          drop:          rideRequest.dropAddress,
          fare:          rideRequest.fare,
          etaMinutes:    etaToPickupMinutes,
        });
      } catch (err) {
        console.warn('WhatsApp ride-accepted notification failed:', err.message);
      }
    });
  } catch (error) {
    console.error("Accept ride error:", error);
    res.status(500).json({ error: "Failed to accept ride" });
  }
};

// Reject ride
const rejectRide = async (req, res) => {
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

  await moveToNextDriver(parseInt(rideId));

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
    currentDriver: rideRequest.status === 'searching' && currentDriver ? {
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



    const rideMeta = await db.query(
      "SELECT consumer_id FROM rides WHERE id = $1",
      [rideId]
    );

    emitRideStageChanged(parseInt(rideId), {
      stage: "in_progress",
      status: "in_progress",
      driverId,
      consumerId: rideMeta.rows[0]?.consumer_id || null,
      timestamp: new Date().toISOString(),
    });

    console.log(`🔐 Drop OTP generated for ride ${rideId}`);
    console.log(`✅ Ride ${rideId} started.`);

    res.json({
      message: 'Ride started successfully.',
      rideId: parseInt(rideId)
    });

    // Generate live-track token + send WhatsApp to safety contacts (async, non-blocking)
    Promise.resolve().then(async () => {
      try {
        const contacts = await getRideSafetyContacts(parseInt(rideId));
        if (contacts.length === 0) return;

        const token    = await generateTrackToken(parseInt(rideId), driverId);
        const trackUrl = `${BACKEND_URL}/live-track/${token}`;

        // Fetch ride + consumer + driver details for message
        const rideRow = await db.query(
          `SELECT r.pickup_address, r.drop_address,
                  c.full_name AS consumer_name,
                  d.full_name AS driver_name
           FROM rides r
           JOIN consumers c ON c.id = r.consumer_id
           JOIN drivers   d ON d.id = r.driver_id
           WHERE r.id = $1`,
          [rideId]
        );
        const row = rideRow.rows[0];

        await sendLiveTrackNotification(contacts, {
          consumerName: row?.consumer_name || 'Your contact',
          driverName:   row?.driver_name   || 'Driver',
          pickup:       row?.pickup_address || '',
          drop:         row?.drop_address   || '',
          trackUrl,
        });
      } catch (err) {
        console.warn('WhatsApp live-track notification failed:', err.message);
      }
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

    const pendingRide = pendingRideRequests.get(parseInt(rideId));
    if (pendingRide) {
      const currentDriver = pendingRide.driverQueue[pendingRide.currentDriverIndex];
      if (currentDriver) {
        releaseDriverLock(currentDriver.id, parseInt(rideId));
      }
      pendingRideRequests.delete(parseInt(rideId));
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

    emitRideStageChanged(parseInt(rideId), {
      stage: "cancelled",
      status: "cancelled",
      cancelledBy: userRole,
      cancelledById: userId,
      timestamp: new Date().toISOString(),
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

    releaseDriverLock(driverId, parseInt(rideId));
    pendingRideRequests.delete(parseInt(rideId));


    const rideMeta = await db.query(
      "SELECT consumer_id FROM rides WHERE id = $1",
      [rideId]
    );

    emitRideStageChanged(parseInt(rideId), {
      stage: "completed",
      status: "completed",
      driverId,
      consumerId: rideMeta.rows[0]?.consumer_id || null,
      timestamp: new Date().toISOString(),
    });

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
