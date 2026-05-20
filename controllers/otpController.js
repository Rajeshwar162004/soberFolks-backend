// otpController.js - OTP verification business logic

const db = require('../db');
const { 
  generateOTP, 
  validateOTPFormat, 
  isOTPExpired, 
  isMaxAttemptsExceeded,
  getExpiryTimestamp 
} = require('../utils/otp');

/**
 * Generate Pickup OTP (called automatically when driver accepts ride)
 * POST /api/otp/rides/:rideId/generate-pickup
 */
const generatePickupOTP = async (req, res) => {
  const { rideId } = req.params;
  const driverId = req.user.id;

  try {
    // Verify driver owns this ride and it's in accepted status
    const rideCheck = await db.query(
      'SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status = $3',
      [rideId, driverId, 'accepted']
    );

    if (rideCheck.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Ride not found or not in accepted status' 
      });
    }

    // Generate 4-digit OTP
    const pickupOTP = generateOTP(4);
    const expiresAt = getExpiryTimestamp(30); // 30 minutes

    // Check if OTP already exists
    const existingOTP = await db.query(
      'SELECT id FROM ride_otp_verifications WHERE ride_id = $1 AND otp_type = $2',
      [rideId, 'pickup']
    );

    if (existingOTP.rows.length > 0) {
      // Update existing OTP
      await db.query(
        `UPDATE ride_otp_verifications 
         SET otp_code = $1, generated_at = NOW(), expires_at = $2, 
             attempts = 0, verified = FALSE, locked = FALSE
         WHERE ride_id = $3 AND otp_type = $4`,
        [pickupOTP, expiresAt, rideId, 'pickup']
      );
    } else {
      // Insert new OTP
      await db.query(
        `INSERT INTO ride_otp_verifications 
         (ride_id, otp_type, otp_code, expires_at) 
         VALUES ($1, $2, $3, $4)`,
        [rideId, 'pickup', pickupOTP, expiresAt]
      );
    }

    console.log(`🔐 Pickup OTP generated for ride ${rideId}`);

    res.json({
      success: true,
      pickupOTP,
      expiresIn: 30 // minutes
    });

  } catch (error) {
    console.error('Generate pickup OTP error:', error);
    res.status(500).json({ error: 'Failed to generate OTP' });
  }
};

/**
 * Verify Pickup OTP (called by consumer)
 * POST /api/otp/rides/:rideId/verify-pickup
 * Body: { otp: "1234" }
 */
const verifyPickupOTP = async (req, res) => {
  const { rideId } = req.params;
  const { otp } = req.body;
  const consumerId = req.user.id;

  try {
    // Validate OTP format
    if (!validateOTPFormat(otp, 4)) {
      return res.status(400).json({ error: 'Invalid OTP format. Must be 4 digits.' });
    }

    // Get ride and verify consumer owns it
    const rideCheck = await db.query(
      'SELECT * FROM rides WHERE id = $1 AND consumer_id = $2 AND status = $3',
      [rideId, consumerId, 'accepted']
    );

    if (rideCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Get OTP details
    const otpResult = await db.query(
      'SELECT * FROM ride_otp_verifications WHERE ride_id = $1 AND otp_type = $2',
      [rideId, 'pickup']
    );

    if (otpResult.rows.length === 0) {
      return res.status(404).json({ error: 'No OTP found for this ride' });
    }

    const otpData = otpResult.rows[0];

    // Check if already verified
    if (otpData.verified) {
      return res.status(400).json({ error: 'OTP already verified' });
    }

    // Check if locked
    if (otpData.locked) {
      return res.status(429).json({ 
        error: 'OTP locked due to too many failed attempts. Contact support.' 
      });
    }

    // Check max attempts
    if (isMaxAttemptsExceeded(otpData.attempts, 5)) {
      await db.query(
        'UPDATE ride_otp_verifications SET locked = TRUE, locked_at = NOW() WHERE id = $1',
        [otpData.id]
      );
      return res.status(429).json({ 
        error: 'Maximum verification attempts exceeded. OTP locked.' 
      });
    }

    // Check expiry
    if (isOTPExpired(otpData.generated_at, 30)) {
      return res.status(400).json({ error: 'OTP has expired. Contact support.' });
    }

    // Verify OTP
    if (otp !== otpData.otp_code) {
      // Increment attempts
      await db.query(
        'UPDATE ride_otp_verifications SET attempts = attempts + 1, last_attempt_at = NOW() WHERE id = $1',
        [otpData.id]
      );

      const attemptsRemaining = 5 - (otpData.attempts + 1);
      
      console.log(`❌ Invalid OTP attempt for ride ${rideId}. Attempts remaining: ${attemptsRemaining}`);

      return res.status(400).json({ 
        error: 'Invalid OTP', 
        attemptsRemaining 
      });
    }

    // ✅ OTP Verified
    await db.query(
      'UPDATE ride_otp_verifications SET verified = TRUE, verified_at = NOW() WHERE id = $1',
      [otpData.id]
    );

    console.log(`✅ Pickup OTP verified for ride ${rideId}`);

    res.json({
      success: true,
      message: 'Pickup verified! Driver can now start the ride.',
      verified: true
    });

  } catch (error) {
    console.error('Verify pickup OTP error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
};

/**
 * Generate Drop OTP (called automatically when driver starts ride)
 * POST /api/otp/rides/:rideId/generate-drop
 */
const generateDropOTP = async (req, res) => {
  const { rideId } = req.params;
  const driverId = req.user.id;

  try {
    // Verify ride is in progress and pickup is verified
    const rideCheck = await db.query(
      `SELECT r.* FROM rides r
       INNER JOIN ride_otp_verifications rov 
       ON r.id = rov.ride_id AND rov.otp_type = 'pickup' AND rov.verified = TRUE
       WHERE r.id = $1 AND r.driver_id = $2 AND r.status = $3`,
      [rideId, driverId, 'in_progress']
    );

    if (rideCheck.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Ride not found, not started, or pickup not verified' 
      });
    }

    // Generate 4-digit OTP
    const dropOTP = generateOTP(4);
    const expiresAt = getExpiryTimestamp(30);

    // Check if OTP already exists
    const existingOTP = await db.query(
      'SELECT id FROM ride_otp_verifications WHERE ride_id = $1 AND otp_type = $2',
      [rideId, 'drop']
    );

    if (existingOTP.rows.length > 0) {
      // Update existing OTP
      await db.query(
        `UPDATE ride_otp_verifications 
         SET otp_code = $1, generated_at = NOW(), expires_at = $2, 
             attempts = 0, verified = FALSE, locked = FALSE
         WHERE ride_id = $3 AND otp_type = $4`,
        [dropOTP, expiresAt, rideId, 'drop']
      );
    } else {
      // Insert new OTP
      await db.query(
        `INSERT INTO ride_otp_verifications 
         (ride_id, otp_type, otp_code, expires_at) 
         VALUES ($1, $2, $3, $4)`,
        [rideId, 'drop', dropOTP, expiresAt]
      );
    }

    console.log(`🔐 Drop OTP generated for ride ${rideId}`);

    res.json({
      success: true,
      dropOTP,
      expiresIn: 30
    });

  } catch (error) {
    console.error('Generate drop OTP error:', error);
    res.status(500).json({ error: 'Failed to generate OTP' });
  }
};

/**
 * Verify Drop OTP (called by driver to complete ride)
 * POST /api/otp/rides/:rideId/verify-drop
 * Body: { otp: "5678" }
 */
const verifyDropOTP = async (req, res) => {
  const { rideId } = req.params;
  const { otp } = req.body;
  const driverId = req.user.id;

  try {
    // Validate OTP format
    if (!validateOTPFormat(otp, 4)) {
      return res.status(400).json({ error: 'Invalid OTP format. Must be 4 digits.' });
    }

    // Get ride and verify driver owns it
    const rideCheck = await db.query(
      'SELECT * FROM rides WHERE id = $1 AND driver_id = $2 AND status = $3',
      [rideId, driverId, 'in_progress']
    );

    if (rideCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Ride not found or not in progress' });
    }

    // Get OTP details
    const otpResult = await db.query(
      'SELECT * FROM ride_otp_verifications WHERE ride_id = $1 AND otp_type = $2',
      [rideId, 'drop']
    );

    if (otpResult.rows.length === 0) {
      return res.status(404).json({ error: 'No drop OTP found for this ride' });
    }

    const otpData = otpResult.rows[0];

    // Check if already verified
    if (otpData.verified) {
      return res.status(400).json({ error: 'OTP already verified' });
    }

    // Check if locked
    if (otpData.locked) {
      return res.status(429).json({ 
        error: 'OTP locked due to too many failed attempts. Contact support.' 
      });
    }

    // Check expiry
    if (isOTPExpired(otpData.generated_at, 30)) {
      return res.status(400).json({ error: 'OTP has expired. Contact support.' });
    }

    // Verify OTP
    if (otp !== otpData.otp_code) {
      const nextAttempts = otpData.attempts + 1;

      await db.query(
        'UPDATE ride_otp_verifications SET attempts = attempts + 1, last_attempt_at = NOW() WHERE id = $1',
        [otpData.id]
      );

      if (isMaxAttemptsExceeded(nextAttempts, 5)) {
        await db.query(
          'UPDATE ride_otp_verifications SET locked = TRUE, locked_at = NOW() WHERE id = $1',
          [otpData.id]
        );

        // Edge Case: Auto-complete the ride if Drop OTP fails 5 times, so the driver isn't stuck.
        await db.query(
          "UPDATE rides SET status = 'completed', completed_at = NOW() WHERE id = $1",
          [rideId]
        );

        await db.query("UPDATE drivers SET is_available = TRUE WHERE id = $1", [driverId]);

        const { emitRideStageChanged } = require('../realtime/socketServer');
        emitRideStageChanged(parseInt(rideId), {
          stage: "completed",
          status: "completed",
          reason: "Drop OTP failed 5 times - Auto-completed",
          timestamp: new Date().toISOString(),
        });

        return res.status(429).json({
          error: 'Maximum verification attempts exceeded. Ride has been auto-completed for safety.',
          attemptsRemaining: 0,
          rideStatus: 'completed',
        });
      }

      const attemptsRemaining = 5 - nextAttempts;
      
      console.log(`❌ Invalid drop OTP attempt for ride ${rideId}. Attempts remaining: ${attemptsRemaining}`);

      return res.status(400).json({ 
        error: 'Invalid OTP', 
        attemptsRemaining 
      });
    }

    // ✅ OTP Verified
    await db.query(
      'UPDATE ride_otp_verifications SET verified = TRUE, verified_at = NOW() WHERE id = $1',
      [otpData.id]
    );

    console.log(`✅ Drop OTP verified for ride ${rideId}`);

    res.json({
      success: true,
      message: 'Drop OTP verified! Ride can be completed.',
      verified: true
    });

  } catch (error) {
    console.error('Verify drop OTP error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
};

/**
 * Get OTP status for a ride
 * GET /api/otp/rides/:rideId/status
 */
const getOTPStatus = async (req, res) => {
  const { rideId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    // Verify user has access to this ride
    const rideCheck = await db.query(
      'SELECT * FROM rides WHERE id = $1 AND (consumer_id = $2 OR driver_id = $2)',
      [rideId, userId]
    );

    if (rideCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Ride not found or access denied' });
    }

    // Get OTP status
    const otpResult = await db.query(
      'SELECT * FROM ride_otp_verifications WHERE ride_id = $1 ORDER BY otp_type',
      [rideId]
    );

    const otpStatus = {
      pickup: null,
      drop: null
    };

    otpResult.rows.forEach(otp => {
      otpStatus[otp.otp_type] = {
        verified: otp.verified,
        attempts: otp.attempts,
        locked: otp.locked,
        expires_at: otp.expires_at,
        // Only show OTP to authorized user
        otp_code: (otp.otp_type === 'pickup' && userRole === 'Driver') ||
                  (otp.otp_type === 'drop' && userRole === 'Consumer') 
                  ? otp.otp_code : null
      };
    });

    res.json({
      success: true,
      rideId: parseInt(rideId),
      otpStatus
    });

  } catch (error) {
    console.error('Get OTP status error:', error);
    res.status(500).json({ error: 'Failed to get OTP status' });
  }
};

module.exports = {
  generatePickupOTP,
  verifyPickupOTP,
  generateDropOTP,
  verifyDropOTP,
  getOTPStatus
};
