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

/**
 * Pin `sql_mode` on every pooled connection so all environments enforce the
 * SAME rules as production.
 *
 * Production (MySQL 8.4) enables ONLY_FULL_GROUP_BY and STRICT_TRANS_TABLES by
 * default. A dev MariaDB / older MySQL does not, so invalid SQL passes locally
 * and 500s only in production — that is exactly how a broken analytics
 * `GROUP BY` shipped (`ER_WRONG_FIELD_WITH_GROUP`), surfacing in the dashboard
 * as the wholly misleading "backend unreachable". Setting it here means dev
 * fails identically to prod, on the same line, before you deploy.
 *
 * This is the mode list MySQL 8.4 applies by default; naming it explicitly also
 * protects against a future server default drifting.
 *
 * Applied via the pool's `connection` event, which mysql2 emits when a new
 * connection is established — the SET is queued on that connection ahead of the
 * caller's first query. Failure is non-fatal: an engine that rejects one of
 * these names must not take the API down, so we warn and carry on.
 */
const SQL_MODE = [
  "ONLY_FULL_GROUP_BY",
  "STRICT_TRANS_TABLES",
  "NO_ZERO_IN_DATE",
  "NO_ZERO_DATE",
  "ERROR_FOR_DIVISION_BY_ZERO",
  "NO_ENGINE_SUBSTITUTION",
].join(",");

// `mysql2/promise` wraps the callback pool; the raw pool is the event emitter.
const rawPool = pool.pool || pool;
rawPool.on("connection", (connection) => {
  connection.query("SET SESSION sql_mode = ?", [SQL_MODE], (err) => {
    if (err) {
      console.warn(
        `Could not pin sql_mode (${err.code || err.message}) — this connection ` +
          `keeps the server default, so dev/prod SQL strictness may differ.`
      );
    }
  });
});

module.exports = {
  pool,
  SQL_MODE,
};
