// errorHandler.js - Centralized error handling middleware

// General error handler
function errorHandler(err, req, res, next) {
  console.error("Error:", err.message);
  res.status(500).json({ error: err.message || "Internal server error" });
}

// 404 Not Found handler
function notFoundHandler(req, res) {
  res.status(404).json({ error: "Route not found" });
}

module.exports = {
  errorHandler,
  notFoundHandler
};
