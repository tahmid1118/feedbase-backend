const jwt = require("jsonwebtoken");
const { pool } = require("../../../database/dbPool");
const { isSessionActive } = require("../../common/sessions");

const getActiveUser = async (id, email) => {
  const [rows] = await pool.query(
    "SELECT id, email, tenant_id, role, full_name, avatar_url FROM users WHERE id = ? AND email = ? AND is_active = 1 LIMIT 1",
    [id, email]
  );
  return rows[0] || null;
};

/**
 * Like `authenticateToken`, but never rejects: if a valid Bearer token is
 * present it attaches `req.auth` (so public actions can be attributed to a
 * logged-in user); otherwise it continues as an anonymous guest.
 */
const optionalAuth = async (req, res, next) => {
  const parts = (req.header("Authorization") || "").split(" ");
  const token = parts[0] === "Bearer" ? parts[1] : null;
  if (!token || token === "undefined" || token === "null") return next();

  jwt.verify(token, process.env.SECRET_ACCESS_TOKEN, async (err, decoded) => {
    if (err || !decoded?.id || !decoded?.email) return next();
    try {
      // A revoked device session can no longer act as that user — fall through
      // as a guest rather than attributing the comment/vote to them.
      if (!decoded.sid || !(await isSessionActive(decoded.sid))) return next();
      const u = await getActiveUser(decoded.id, decoded.email);
      if (u) {
        req.auth = {
          id: u.id,
          email: u.email,
          tenantId: u.tenant_id,
          role: u.role,
          fullName: u.full_name,
          avatarUrl: u.avatar_url,
        };
      }
    } catch {
      /* fall through as guest */
    }
    next();
  });
};

module.exports = { optionalAuth };
