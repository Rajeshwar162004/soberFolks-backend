const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const db = require("../db");
const { JWT_SECRET } = require("../config/constants");
const { persistRideMessage } = require("../utils/chatMessages");

let ioInstance = null;

function getTokenFromSocket(socket) {
  const header = socket.handshake.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    return header.slice(7);
  }

  return socket.handshake.auth?.token || socket.handshake.query?.token;
}

async function canAccessRide(userId, rideId) {
  const result = await db.query(
    "SELECT id FROM rides WHERE id = $1 AND (consumer_id = $2 OR driver_id = $2)",
    [rideId, userId]
  );

  return result.rows.length > 0;
}

function initRealtime(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    const token = getTokenFromSocket(socket);
    if (!token) {
      return next(new Error("Authentication token missing"));
    }

    try {
      const user = jwt.verify(token, JWT_SECRET);
      socket.data.user = user;
      return next();
    } catch (error) {
      return next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("ride:join", async (payload = {}, callback) => {
      try {
        const rideId = parseInt(payload.rideId, 10);
        if (!rideId) {
          throw new Error("rideId is required");
        }

        const allowed = await canAccessRide(socket.data.user.id, rideId);
        if (!allowed) {
          throw new Error("Unauthorized ride room access");
        }

        const roomName = `ride_${rideId}`;
        await socket.join(roomName);

        if (typeof callback === "function") {
          callback({ success: true, rideId });
        }
      } catch (error) {
        if (typeof callback === "function") {
          callback({ success: false, error: error.message });
        }
      }
    });

    socket.on("ride:leave", async (payload = {}, callback) => {
      try {
        const rideId = parseInt(payload.rideId, 10);
        if (!rideId) {
          throw new Error("rideId is required");
        }

        await socket.leave(`ride_${rideId}`);
        if (typeof callback === "function") {
          callback({ success: true, rideId });
        }
      } catch (error) {
        if (typeof callback === "function") {
          callback({ success: false, error: error.message });
        }
      }
    });

    socket.on("chat:send", async (payload = {}, callback) => {
      try {
        const rideId = parseInt(payload.rideId, 10);
        const messageType = payload.messageType || "text";
        const body = typeof payload.body === "string" ? payload.body.trim() : "";

        if (!rideId) {
          throw new Error("rideId is required");
        }
        if (!body) {
          throw new Error("Message body is required");
        }

        const allowed = await canAccessRide(socket.data.user.id, rideId);
        if (!allowed) {
          throw new Error("Unauthorized chat access");
        }

        const result = await persistRideMessage({
          rideId,
          senderId: socket.data.user.id,
          senderRole: socket.data.user.role,
          messageType,
          body,
          clientMessageId: payload.clientMessageId || null,
        });

        if (result.inserted) {
          io.to(`ride_${rideId}`).emit("chat:message", result.message);
        }

        if (typeof callback === "function") {
          callback({ success: true, message: result.message });
        }
      } catch (error) {
        if (typeof callback === "function") {
          callback({ success: false, error: error.message });
        }
      }
    });

    socket.on("chat:typing", async (payload = {}) => {
      const rideId = parseInt(payload.rideId, 10);
      if (!rideId) {
        return;
      }

      const allowed = await canAccessRide(socket.data.user.id, rideId);
      if (!allowed) {
        return;
      }

      socket.to(`ride_${rideId}`).emit("chat:typing", {
        rideId,
        userId: socket.data.user.id,
        role: socket.data.user.role,
        isTyping: Boolean(payload.isTyping),
      });
    });
  });

  ioInstance = io;
  return io;
}

function getIO() {
  return ioInstance;
}

function emitRideStageChanged(rideId, payload) {
  if (!ioInstance) {
    return;
  }

  ioInstance.to(`ride_${rideId}`).emit("ride:stage-changed", {
    rideId,
    ...payload,
  });
}

function emitDriverLocationUpdated(rideId, payload) {
  if (!ioInstance) {
    return;
  }

  ioInstance.to(`ride_${rideId}`).emit("ride:driver-location", {
    rideId,
    ...payload,
  });
}

function emitChatMessage(rideId, payload) {
  if (!ioInstance) {
    return;
  }

  ioInstance.to(`ride_${rideId}`).emit("chat:message", {
    rideId,
    ...payload,
  });
}

module.exports = {
  initRealtime,
  getIO,
  emitRideStageChanged,
  emitDriverLocationUpdated,
  emitChatMessage,
};
