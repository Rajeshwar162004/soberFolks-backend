// server.js - SoberFolks API Entry Point (Refactored & Modular)

const express = require("express");
const cors = require("cors");
const http = require("http");
require("dotenv").config({ quiet: true });

// Import configurations
const { PORT, GEOHASH_PRECISION } = require("./config/constants");
const { pendingRideRequests } = require("./utils/rideState");

// Import middleware
const { errorHandler, notFoundHandler } = require("./middleware/errorHandler");

// Import routes
const authRoutes = require("./routes/authRoutes");
const locationRoutes = require("./routes/locationRoutes");
const ridesRoutes = require("./routes/rideRoutes");
const profileRoutes = require("./routes/profileRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const mapsRoutes = require("./routes/mapsRoutes");
const otpRoutes = require("./routes/otpRoutes");
const chatRoutes = require("./routes/chatRoutes");
const safetyRoutes = require("./routes/safetyRoutes");
const { initRealtime } = require("./realtime/socketServer");

const app = express();
const server = http.createServer(app);

// -------- Middleware --------
app.use(cors()); // Allow all origins for React Native
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// -------- API Routes --------
app.use("/", authRoutes);                     // /signup, /login
app.use("/api/location", locationRoutes);     // /api/location/update, /api/location/current
app.use("/api/rides", ridesRoutes);           // /api/rides/* and /api/driver/pending-rides  
app.use("/profile", profileRoutes);           // /profile/:role/:id, /driver/:id/availability
app.use("/api/feedback", feedbackRoutes);     // /api/feedback/*
app.use("/api", mapsRoutes);                  // /api/geocode, /api/directions, /api/places/*
app.use("/api/otp", otpRoutes);               // /api/otp/* - OTP verification endpoints
app.use("/api/chat", chatRoutes);             // /api/chat/rides/:rideId/messages
app.use("/live-track", safetyRoutes);         // /live-track/:token — public HTML tracking page
app.use("/api/live-track", safetyRoutes);     // /api/live-track/:token/location — JSON for tracking page

// -------- Health Check --------
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    server: "SoberFolks API with Complete Booking System and Geohashing",
    features: [
      "Authentication",
      "Location Tracking with Geohashing",
      "Driver Queue Management",
      "Ride Booking with Timeout",
      "Real-time Driver Matching",
      "Geocoding & Directions",
      "Geohash-based Driver Search"
    ],
    activeRideRequests: pendingRideRequests.size
  });
});

// -------- Error Handling --------
app.use(errorHandler);
app.use(notFoundHandler);

// -------- Realtime --------
initRealtime(server);

// -------- Start Server --------
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SoberFolks API running at http://0.0.0.0:${PORT}`);
  console.log(`📍 Features enabled:`);
  console.log(`   ✓ Real-time location tracking with geohashing`);
  console.log(`   ✓ Geohash-based driver queue management (top 3 nearest)`);
  console.log(`   ✓ 30-second timeout per driver`);
  console.log(`   ✓ Automatic driver rotation`);
  console.log(`   ✓ Distance-based fare calculation`);
  console.log(`   ✓ Google Maps integration`);
  console.log(`   ✓ Realtime ride and chat channel`);
  console.log(`   ✓ Ride booking and management`);
  console.log(`   ✓ Geohash precision: ${GEOHASH_PRECISION} (~1.2km accuracy)`);
  console.log(`\n🏗️  Architecture: Modular (routes → controllers → utils)`);
  console.log(`\n📂 Structure:`);
  console.log(`   ├── config/       (constants, database)`);
  console.log(`   ├── middleware/   (auth, errorHandler)`);
  console.log(`   ├── utils/        (helpers, distance, geohash, geocoding, rideState)`);
  console.log(`   ├── controllers/  (authController, locationController, rideController, feedbackController, mapsController)`);
  console.log(`   └── routes/       (authRoutes, locationRoutes, rideRoutes, profileRoutes, feedbackRoutes, mapsRoutes)\n`);
});
