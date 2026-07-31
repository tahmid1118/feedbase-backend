const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { setAccountPlan, cancelActiveSubscription } = require("../../common/accountBilling");
const { isPaddleActive } = require("../../common/billingProvider");

/**
 * Redeem a promo code for the authenticated ACCOUNT (owner only). A free-plan
 * comp applies to the account and therefore to every workspace it owns.
 *  - free_plan  → comp the plan immediately (no Stripe, no card). The reconcile
 *                 guard preserves 'comped' status so it isn't reset on load.
 *  - percent_off→ validate and return the Stripe promotion code id, which the
 *                 client passes into Checkout as a discount.
 */
const redeemPromo = async (code, authData) => {
  const { tenantId, role, id: userId, email, lg } = authData;

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
    // Fast pre-check for a clean error message. This is NOT the guarantee — the
    // UNIQUE (promo_code_id, account_email) index is (see claimRedemption).
    const [already] = await pool.query(
      "SELECT id FROM promo_redemptions WHERE promo_code_id = ? AND account_email = ? LIMIT 1",
      [promo.id, email]
    );
    if (already.length > 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "promo_already_redeemed", lg));
    }

    /**
     * Claim a redemption ATOMICALLY, for BOTH code types.
     *
     * Previously only the free_plan branch recorded anything, so a percent_off
     * code could be redeemed by the same account over and over and
     * `max_redemptions` was never enforced for it at all.
     *
     * Two races are closed here:
     *  - the global cap, by incrementing inside a conditional UPDATE (…AND
     *    times_redeemed < max_redemptions) so only one of N concurrent callers
     *    can take the last slot;
     *  - the per-account rule, by the UNIQUE index, so a duplicate INSERT fails
     *    (ER_DUP_ENTRY) instead of two requests both passing the SELECT above.
     */
    const claimRedemption = async (planGranted, expiresAt) => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [upd] = await conn.query(
          `UPDATE promo_codes
              SET times_redeemed = times_redeemed + 1
            WHERE id = ? AND is_active = 1
              AND (expires_at IS NULL OR expires_at > NOW())
              AND (max_redemptions IS NULL OR times_redeemed < max_redemptions)`,
          [promo.id]
        );
        if (upd.affectedRows === 0) {
          await conn.rollback();
          return { ok: false, reason: "promo_code_exhausted" };
        }
        await conn.query(
          `INSERT INTO promo_redemptions
             (promo_code_id, tenant_id, redeemed_by_user_id, account_email, plan_granted, expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [promo.id, tenantId, userId, email, planGranted, expiresAt]
        );
        await conn.commit();
        return { ok: true };
      } catch (e) {
        await conn.rollback();
        if (e?.code === "ER_DUP_ENTRY") return { ok: false, reason: "promo_already_redeemed" };
        throw e;
      } finally {
        conn.release();
      }
    };

    /** Give the claim back if the work it paid for could not be completed. */
    const releaseRedemption = async () => {
      try {
        await pool.query("DELETE FROM promo_redemptions WHERE promo_code_id = ? AND account_email = ?", [promo.id, email]);
        await pool.query("UPDATE promo_codes SET times_redeemed = GREATEST(times_redeemed - 1, 0) WHERE id = ?", [promo.id]);
      } catch (e) {
        console.error("releaseRedemption failed (promo slot may stay consumed):", e.message);
      }
    };

    if (promo.type === "free_plan") {
      const periodEnd =
        promo.duration === "forever"
          ? null
          : new Date(
              Date.now() + (promo.duration_months || 1) * 30 * 24 * 60 * 60 * 1000
            );

      // Claim the redemption BEFORE granting anything, so a race can't hand the
      // plan to two accounts (or the same account twice) off one code.
      const claim = await claimRedemption(promo.plan_grant, periodEnd);
      if (!claim.ok) {
        return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, claim.reason, lg));
      }

      try {
      // If the ACCOUNT has a live paid subscription on the active provider, cancel
      // it before comping — otherwise the provider keeps charging while the app
      // shows a comped plan (and reconcileAccount then skips comped accounts).
      await cancelActiveSubscription(email);

      // Comp the account → mirrors onto every workspace it owns.
      await setAccountPlan(email, {
        plan_name: promo.plan_grant,
        subscription_status: "comped",
        billing_interval: null,
        stripe_subscription_id: null,
        paddle_subscription_id: null,
        current_period_end: periodEnd,
        pending_plan: null,
        pending_interval: null,
        pending_effective_at: null,
      });
      } catch (e) {
        // The grant failed, so don't consume the customer's one redemption.
        await releaseRedemption();
        throw e;
      }
      return Promise.resolve(
        setServerResponse(API_STATUS_CODE.OK, "promo_code_redeemed", lg, {
          type: "free_plan",
          plan: promo.plan_grant,
        })
      );
    }

    // percent_off: the client passes this back into checkout, where the ACTIVE
    // provider applies it (Paddle discount id, or Stripe promotion code id).
    // This is recorded exactly like a comp — without it the same account could
    // redeem the code endlessly and max_redemptions would never bite.
    const pctClaim = await claimRedemption(null, null);
    if (!pctClaim.ok) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, pctClaim.reason, lg));
    }

    const promotionCode = isPaddleActive()
      ? promo.paddle_discount_id
      : promo.stripe_promotion_code_id;
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "promo_code_valid", lg, {
        type: "percent_off",
        percentOff: promo.percent_off,
        appliesToPlan: promo.applies_to_plan,
        promotionCode,
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
