// feedbackController.js - Ride feedback and ratings

const db = require("../db");

// Submit feedback for a ride
const submitFeedback = async (req, res) => {
  const {
    rideId,
    userType, // 'driver' | 'customer'
    overallRating,
    cleanlinessRating = 0,
    safetyRating = 0,
    communicationRating = 0,
    punctualityRating = 0,
    comments = null,
    tags = null, // array
  } = req.body;

  if (!rideId || !userType || !['driver','customer'].includes(userType) || !overallRating) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  try {
    // Verify ride exists and the caller is part of this ride
    const verifyQuery = `
      SELECT r.id, r.consumer_id, r.driver_id, r.status
      FROM rides r
      WHERE r.id = $1
      LIMIT 1
    `;
    const vResult = await db.query(verifyQuery, [rideId]);
    if (vResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Ride not found" });
    }

    const ride = vResult.rows[0];
    const callerId = req.user.id;

    if (userType === 'customer') {
      if (ride.consumer_id !== callerId) {
        return res.status(403).json({ success: false, error: "Not your ride" });
      }
    } else {
      if (ride.driver_id !== callerId) {
        return res.status(403).json({ success: false, error: "Not your ride" });
      }
    }

    // Prevent duplicate feedback per ride per userType
    const existsQuery = `
      SELECT id FROM feedback
      WHERE ride_id = $1 AND user_type = $2
      LIMIT 1
    `;
    const eResult = await db.query(existsQuery, [rideId, userType]);
    if (eResult.rows.length > 0) {
      return res.status(409).json({ success: false, error: "Feedback already submitted" });
    }

    const insertQuery = `
      INSERT INTO feedback
      (ride_id, user_id, user_type, overall_rating, cleanliness_rating, safety_rating, communication_rating, punctuality_rating, comments, tags, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING id
    `;
    const tagsJson = tags ? JSON.stringify(tags) : null;
    const insertResult = await db.query(
      insertQuery,
      [rideId, callerId, userType, overallRating, cleanlinessRating, safetyRating, communicationRating, punctualityRating, comments, tagsJson]
    );
    
    return res.json({ success: true, id: insertResult.rows[0].id });
  } catch (error) {
    console.error("Submit feedback error:", error);
    return res.status(500).json({ success: false, error: "Failed to save feedback" });
  }
};

// Get feedback for a specific ride
const getRideFeedback = async (req, res) => {
  const { rideId } = req.params;
  const q = `
    SELECT f.*, u.full_name as user_name
    FROM feedback f
    LEFT JOIN consumers c ON (f.user_type = 'customer' AND c.id = f.user_id)
    LEFT JOIN drivers d   ON (f.user_type = 'driver'   AND d.id = f.user_id)
    LEFT JOIN (
      SELECT id, full_name FROM consumers
      UNION ALL
      SELECT id, full_name FROM drivers
    ) u ON u.id = f.user_id
    WHERE f.ride_id = $1
    ORDER BY f.created_at ASC
  `;
  try {
    const result = await db.query(q, [rideId]);
    const data = result.rows.map(r => ({
      id: r.id,
      rideId: r.ride_id,
      userId: r.user_id,
      userType: r.user_type,
      overallRating: r.overall_rating,
      cleanlinessRating: r.cleanliness_rating,
      safetyRating: r.safety_rating,
      communicationRating: r.communication_rating,
      punctualityRating: r.punctuality_rating,
      comments: r.comments,
      tags: r.tags ? JSON.parse(r.tags) : [],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      userName: r.user_name || null,
    }));
    res.json({ success: true, feedback: data });
  } catch (error) {
    console.error("Get feedback error:", error);
    res.status(500).json({ success: false, error: "DB error" });
  }
};

// Get aggregate rating summary for a driver
const getDriverSummary = async (req, res) => {
  const { driverId } = req.params;
  const q = `
    SELECT 
      COUNT(*) as total, 
      AVG(overall_rating) as avgOverall
    FROM feedback f
    INNER JOIN rides r ON r.id = f.ride_id
    WHERE r.driver_id = $1 AND f.user_type = 'customer'
  `;
  try {
    const result = await db.query(q, [driverId]);
    const row = result.rows[0] || { total: 0, avgOverall: null };
    res.json({ success: true, total: row.total, avgOverall: row.avgOverall });
  } catch (error) {
    console.error("Get driver summary error:", error);
    res.status(500).json({ success: false, error: "DB error" });
  }
};

module.exports = {
  submitFeedback,
  getRideFeedback,
  getDriverSummary,
};
