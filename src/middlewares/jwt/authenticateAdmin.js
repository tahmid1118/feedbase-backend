const jwt = require("jsonwebtoken");
const { pool } = require("../../../database/dbPool");

/**
 * Guards the /admin/* platform routes. Requires a Bearer token whose payload has
 * `scope:'admin'` (issued by adminLogin) and that maps to an active row in the
 * `admins` table. Sets `req.admin = { id, email, fullName }`.
 *
 * This is intentionally distinct from `authenticateToken` (which loads tenant
 * users), so an ordinary user token can never reach an admin route.
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
    if (err || !decoded || decoded.scope !== "admin" || !decoded.adminId) {
      return res.status(401).send("Access denied");
    }
    try {
      const [rows] = await pool.query(
        "SELECT id, email, full_name FROM admins WHERE id = ? AND is_active = 1 LIMIT 1",
        [decoded.adminId]
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
