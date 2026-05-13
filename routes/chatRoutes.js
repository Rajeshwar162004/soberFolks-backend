const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { getRideMessages, sendRideMessage } = require("../controllers/chatController");

const router = express.Router();

router.get("/rides/:rideId/messages", authenticateToken, getRideMessages);
router.post("/rides/:rideId/messages", authenticateToken, sendRideMessage);

module.exports = router;
