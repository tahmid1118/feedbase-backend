const jwt = require("jsonwebtoken");
const { pool } = require("../../../database/dbPool");

/**
 * Guards the /admin/* platform routes. Requires a Bearer token with
 * `scope:'admin'` (issued by adminLogin) whose account still holds the
 * platform-admin role — now a flag on the `users` account
 * (`users.is_platform_admin`), checked by EMAIL so it doesn't matter which
 * workspace row the login happened to pick. Sets `req.admin = { id, email,
 * fullName }` (id is a `users.id`).
 *
 * Still distinct from `authenticateToken`: an ordinary user token has no
 * `scope:'admin'`, so it can never reach an admin route.
 */
const authenticateAdmin = async (req, res, next) => {
  const header = req.header("Authorization");
  if (!header) return res.status(401).send("Access denied");

  const parts = header.split(" ");
  if (
    parts[0] !== "Bearer" ||
    !parts[1] ||
    parts[1] === "undefined" ||
    parts[1] === "null"
  ) {
    return res.status(401).send("Invalid token");
  }

  jwt.verify(parts[1], process.env.SECRET_ACCESS_TOKEN, async (err, decoded) => {
    if (err || !decoded || decoded.scope !== "admin" || !decoded.email) {
      return res.status(401).send("Access denied");
    }
    try {
      const [rows] = await pool.query(
        `SELECT id, email, full_name
           FROM users
          WHERE email = ? AND is_platform_admin = 1 AND is_active = 1
          ORDER BY id LIMIT 1`,
        [decoded.email]
      );
      if (rows.length === 0) return res.status(401).send("Access denied");
      req.admin = {
        id: rows[0].id,
        email: rows[0].email,
        fullName: rows[0].full_name,
      };
      next();
    } catch (error) {
      console.error("authenticateAdmin error:", error);
      return res.status(401).send("Access denied");
    }
  });
};

module.exports = { authenticateAdmin };
