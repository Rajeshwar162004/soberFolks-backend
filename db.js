// db.js — hard-coded to Railway public TCP proxy (yamanote.proxy.rlwy.net:31895)

const mysql = require('mysql2');

const connection = mysql.createPool({
  host: 'yamanote.proxy.rlwy.net',      // public proxy domain from Railway Networking
  port: 31895,                          // proxy port mapped to MySQL 3306
  user: 'root',                         // as shown in your Railway vars
  password: 'qFfhaWJmjTBecBEhligfhUcfEMdYZhQl', // root password from your Railway vars
  database: 'SoberFolks',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  acquireTimeout: 10000,
});

// Test connection once at startup
connection.query('SELECT 1', (err, results) => {
  if (err) {
    console.error('❌ DB connection failed:', err);
  } else {
    console.log('✅ Database connected successfully');
  }
});

connection.on('error', (err) => {
  console.error('MySQL pool error:', err);
});

module.exports = connection;
