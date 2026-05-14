// utils/liveTrack.js — Token generation and validation for live ride tracking

const crypto = require('crypto');
const db = require('../db');

const TOKEN_TTL_HOURS = 6;

async function ensureLiveTrackTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS live_track_tokens (
      token      TEXT PRIMARY KEY,
      ride_id    INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
      driver_id  INTEGER NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(
    `CREATE INDEX IF NOT EXISTS idx_live_track_ride_id ON live_track_tokens(ride_id)`
  );
}

async function generateTrackToken(rideId, driverId) {
  await ensureLiveTrackTable();
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await db.query(
    `INSERT INTO live_track_tokens (token, ride_id, driver_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [token, rideId, driverId, expiresAt]
  );
  return token;
}

async function validateTrackToken(token) {
  await ensureLiveTrackTable();
  const result = await db.query(
    `SELECT
       t.ride_id, t.driver_id,
       r.status        AS ride_status,
       r.pickup_address, r.drop_address,
       r.pickup_latitude, r.pickup_longitude,
       r.drop_latitude,  r.drop_longitude,
       r.fare,
       d.full_name     AS driver_name,
       c.full_name     AS consumer_name
     FROM live_track_tokens t
     JOIN rides   r ON r.id = t.ride_id
     JOIN drivers d ON d.id = t.driver_id
     JOIN consumers c ON c.id = r.consumer_id
     WHERE t.token = $1 AND t.expires_at > NOW()`,
    [token]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

async function expireTokensForRide(rideId) {
  await ensureLiveTrackTable();
  await db.query(
    `UPDATE live_track_tokens SET expires_at = NOW() WHERE ride_id = $1`,
    [rideId]
  );
}

module.exports = { generateTrackToken, validateTrackToken, expireTokensForRide, ensureLiveTrackTable };
