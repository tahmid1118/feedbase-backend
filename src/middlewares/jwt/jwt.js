const jwt = require("jsonwebtoken");
const { pool } = require("../../../database/dbPool");
const { isSessionActive, touchSession } = require("../../common/sessions");

const getActiveUser = async (id, email) => {
  const query = `
    SELECT
        id,
        email,
        tenant_id,
        role
    FROM
        users
    WHERE
        id = ? AND
        email = ? AND
        is_active = 1
    LIMIT 1;
`;

  const values = [id, email];

  try {
    const [result] = await pool.query(query, values);
    return result.length > 0 ? result[0] : null;
  } catch (error) {
    return Promise.reject(error);
  }
};

const authenticateToken = async (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) return res.status(400).send("Access denied");
  const authToken = token.split(" ");

  if (
    authToken[0] !== "Bearer" ||
    !authToken[1] ||
    authToken[1] === "undefined" ||
    authToken[1] === "null"
  ) {
    return res.status(400).send("Invalid token");
  }

  jwt.verify(
    authToken[1],
    process.env.SECRET_ACCESS_TOKEN,
    async (err, user) => {
      if (err) {
        console.error("JWT Verification Error:", err);
        return res.status(400).send("Invalid token");
      }
      const { id, email, sid } = user;
      if (!id || !email) {
        return res.status(400).send("Invalid token");
      }

      // Every user token carries a device-session id (`sid`). A revoked session
      // — signed out here, or taken over by a new login after this device went
      // idle — is dead at once; we don't wait for the JWT to expire. 401 (not
      // 400) so the client can distinguish "session gone" from a bad request
      // and sign the user out cleanly. Tokens minted before this feature have
      // no `sid` and are likewise rejected: everyone re-authenticates once.
      if (!sid || !(await isSessionActive(sid))) {
        return res.status(401).send("Session ended");
      }

      try {
        const userInfo = await getActiveUser(id, email);
        if (userInfo) {
          req.auth = {
            id: userInfo.id,
            email: userInfo.email,
            tenantId: userInfo.tenant_id,
            role: userInfo.role,
            sid,
          };
          // Keep the session warm so it's never mistaken for abandoned. The
          // write is throttled to once a minute; a failure must not break the
          // request.
          touchSession(sid).catch(() => {});
          next();
        } else {
          return res.status(400).send("Invalid user");
        }
      } catch (error) {
        return res.status(400).send("Invalid user");
      }
    }
  );
};

module.exports = {
  authenticateToken,
};
