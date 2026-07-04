const mysql = require("mysql2/promise");

/**
 * Creates and configures a MySQL connection pool for managing database connections efficiently.
 *
 * This pool manages a set of connections to the MySQL database, allowing reuse of connections
 * for better performance and handling concurrent requests without opening new connections repeatedly.
 * Usage:
 * - The pool handles acquiring and releasing connections automatically.
 * - Use `pool.getConnection()` or `pool.query()` to interact with the database.
 */
const pool = mysql.createPool({
  port: process.env.DB_PORT,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  // Tunable via env so prod can scale without a code change.
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 15,
  queueLimit: 0,
  // DATETIME columns (created_at, …) are written by MySQL's CURRENT_TIMESTAMP in
  // the server's SYSTEM timezone. Interpret them in the same (Node process) zone
  // so the JS Date is a correct instant — NOT "+00:00", which mislabels
  // local wall-clock as UTC and pushes every timestamp off by the server offset
  // (e.g. UTC+6 made "35 min ago" render as "in 6 hours"). Keep the DB and app
  // servers in the same timezone.
  timezone: "local",
  // Recycle idle connections instead of holding them open forever.
  maxIdle: Number(process.env.DB_MAX_IDLE) || 10,
  idleTimeout: 60000,
  // Keep-alive stops the DB/load balancer from silently dropping pooled
  // sockets, which otherwise surfaces as random ECONNRESET on the next query.
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 10000,
});

module.exports = {
  pool,
};
