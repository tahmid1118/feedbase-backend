const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/** Platform-wide counts for the admin overview. */
const getOverview = async (lg) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM tenants) AS tenants,
        (SELECT COUNT(*) FROM tenants WHERE is_active = 1) AS active_tenants,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM posts) AS posts,
        (SELECT COUNT(*) FROM tenants WHERE plan_name IN ('pro','business')) AS paid_subs
    `);
    const [plans] = await pool.query(
      "SELECT plan_name, COUNT(*) AS n FROM tenants GROUP BY plan_name"
    );

    let redemptions = 0;
    try {
      const [r] = await pool.query("SELECT COUNT(*) AS n FROM promo_redemptions");
      redemptions = r[0].n;
    } catch (_) {
      /* table may not exist yet */
    }

    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, {
        ...rows[0],
        redemptions,
        plan_breakdown: plans,
      })
    );
  } catch (error) {
    console.error("admin overview error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { getOverview };
