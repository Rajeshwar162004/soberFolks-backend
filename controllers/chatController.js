const { emitChatMessage } = require("../realtime/socketServer");
const db = require("../db");
const { ensureRideMessagesTable, persistRideMessage } = require("../utils/chatMessages");

async function getRideForParticipant(rideId, userId) {
  const result = await db.query(
    `SELECT id, consumer_id, driver_id, status
     FROM rides
     WHERE id = $1 AND (consumer_id = $2 OR driver_id = $2)`,
    [rideId, userId]
  );

  return result.rows[0] || null;
}

const getRideMessages = async (req, res) => {
  const rideId = parseInt(req.params.rideId, 10);
  const { id: userId } = req.user;
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 100);
  const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

  if (!rideId) {
    return res.status(400).json({ error: "Valid rideId is required" });
  }

  try {
    const ride = await getRideForParticipant(rideId, userId);
    if (!ride) {
      return res.status(403).json({ error: "Unauthorized chat access" });
    }

    await ensureRideMessagesTable();

    const result = await db.query(
      `SELECT id, ride_id, sender_id, sender_role, message_type, body, client_message_id, created_at, delivered_at, read_at
       FROM ride_messages
       WHERE ride_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [rideId, limit, offset]
    );

    res.json({
      success: true,
      rideId,
      messages: result.rows.reverse(),
      pagination: { limit, offset, returned: result.rows.length },
    });
  } catch (error) {
    console.error("Get ride messages error:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};

const sendRideMessage = async (req, res) => {
  const rideId = parseInt(req.params.rideId, 10);
  const { id: userId, role } = req.user;
  const messageType = req.body.messageType || "text";
  const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
  const clientMessageId = req.body.clientMessageId || null;

  if (!rideId) {
    return res.status(400).json({ error: "Valid rideId is required" });
  }

  if (!body) {
    return res.status(400).json({ error: "Message body is required" });
  }

  try {
    const ride = await getRideForParticipant(rideId, userId);
    if (!ride) {
      return res.status(403).json({ error: "Unauthorized chat access" });
    }

    const result = await persistRideMessage({
      rideId,
      senderId: userId,
      senderRole: role,
      messageType,
      body,
      clientMessageId,
    });

    if (result.inserted) {
      emitChatMessage(rideId, result.message);
    }

    res.status(result.inserted ? 201 : 200).json({ success: true, message: result.message });
  } catch (error) {
    console.error("Send ride message error:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
};

module.exports = {
  getRideMessages,
  sendRideMessage,
};
