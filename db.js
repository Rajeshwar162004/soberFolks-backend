// // db.js — PostgreSQL Database Connection Pool

// const { Pool } = require('pg');
// require('dotenv').config();

// // Create PostgreSQL connection pool
// const pool = new Pool({
//   host: process.env.DB_HOST || 'localhost',
//   port: parseInt(process.env.DB_PORT) || 5432,
//   user: process.env.DB_USER || 'postgres',
//   password: process.env.DB_PASSWORD|| 'root',
//   database: process.env.DB_NAME || 'soberfolks',
//   max: 20,                    // Maximum number of clients in the pool
//   // idleTimeoutMillis: 100000,   // Close idle clients after 30 seconds
//   // connectionTimeoutMillis: 10000, // Connection timeout
// });


// // Test connection once at startup
// pool.query('SELECT NOW()', (err, result) => {
//   if (err) {
//     console.error('❌ PostgreSQL connection failed:', err.message);
//     console.error('📋 Connection details:', {
//       host: process.env.DB_HOST,
//       port: process.env.DB_PORT,
//       user: process.env.DB_USER,
//       database: process.env.DB_NAME
//     });
//   } else {
//     console.log('✅ PostgreSQL Database connected successfully');
//     console.log('🕐 Server time:', result.rows[0].now);
//   }
// });

// // Handle pool errors
// pool.on('error', (err) => {
//   console.error('❌ Unexpected PostgreSQL pool error:', err);
// });


// // Export the pool for querying
// module.exports = pool;





const { Pool } = require('pg');
require('dotenv').config();

// RENDER PRODUCTION DATABASE CONNECTION
console.log('🔍 DATABASE_URL:', process.env.DATABASE_URL ? 'FOUND' : 'NOT FOUND');
console.log('🔍 Connection string:', process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for Render SSL
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test connection once at startup
pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('❌ Render PostgreSQL connection failed:', err.message);
  } else {
    console.log('✅ PostgreSQL Database connected successfully');
    console.log('🕐 Server time:', result.rows[0].now);
    
    // Show which database we're actually connected to
    pool.query('SELECT current_database()', (err2, result2) => {
      if (!err2) {
        console.log('📊 Connected database:', result2.rows[0].current_database);
      }
    });
  }
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err);
});

// Export the pool for querying
module.exports = pool;