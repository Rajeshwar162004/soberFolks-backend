const mysql = require("mysql2");

const connection = mysql.createPool({
  host: process.env.DB_HOST || 'crossover.proxy.rlwy.net',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'BQUAksWCdcCleLkTTXabJUfRKvPNIKZi',
  database: process.env.DB_NAME || 'SoberFolks',
  port: process.env.DB_PORT || 52505,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test connection
connection.query("SELECT 1", (err, results) => {
  if (err) {
    console.error("❌ DB connection failed:", err);
  } else {
    console.log("✅ Database connected successfully");
  }
});

module.exports = connection;
