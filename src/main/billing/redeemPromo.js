const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");

/**
 * Redeem a promo code for the authenticated workspace (owner only).
 *  - free_plan  → comp the plan immediately (no Stripe, no card). The reconcile
 *                 guard preserves 'comped' status so it isn't reset on load.
 *  - percent_off→ validate and return the Stripe promotion code id, which the
 *                 client passes into Checkout as a discount.
 */
const redeemPromo = async (code, authData) => {
  const { tenantId, role, id: userId, lg } = authData;

  if (role !== "owner") {
    return Promise.reject(setServerResponse(API_STATUS_CODE.FORBIDDEN, "billing_forbidden", lg));
  }

  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "promo_code_invalid", lg));
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM promo_codes WHERE code = ? AND is_active = 1",
      [normalized]
    );
    if (rows.length === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "promo_code_invalid", lg));
    }
    const promo = rows[0];

    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "promo_code_expired", lg));
    }
    if (promo.max_redemptions && promo.times_redeemed >= promo.max_redemptions) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "promo_code_exhausted", lg));
    }
    const [already] = await pool.query(
      "SELECT id FROM promo_redemptions WHERE promo_code_id = ? AND tenant_id = ?",
      [promo.id, tenantId]
    );
    if (already.length > 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "promo_already_redeemed", lg));
    }

    if (promo.type === "free_plan") {
      const periodEnd =
        promo.duration === "forever"
          ? null
          : new Date(
              Date.now() + (promo.duration_months || 1) * 30 * 24 * 60 * 60 * 1000
            );
      await pool.query(
        "UPDATE tenants SET plan_name = ?, subscription_status = 'comped', current_period_end = ? WHERE id = ?",
        [promo.plan_grant, periodEnd, tenantId]
      );
      await pool.query(
        `INSERT INTO promo_redemptions
           (promo_code_id, tenant_id, redeemed_by_user_id, plan_granted, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [promo.id, tenantId, userId, promo.plan_grant, periodEnd]
      );
      await pool.query(
        "UPDATE promo_codes SET times_redeemed = times_redeemed + 1 WHERE id = ?",
        [promo.id]
      );
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "promo_code_redeemed", lg, {
          type: "free_plan",
          plan: promo.plan_grant,
        })
      );
    }

    // percent_off: the client applies this at Checkout.
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "promo_code_valid", lg, {
        type: "percent_off",
        percentOff: promo.percent_off,
        appliesToPlan: promo.applies_to_plan,
        promotionCode: promo.stripe_promotion_code_id,
      })
    );
  } catch (error) {
    console.error("redeemPromo error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { redeemPromo };
