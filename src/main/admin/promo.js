const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { stripe, isStripeConfigured } = require("../../common/stripe");
const { isPaddleActive } = require("../../common/billingProvider");
const { createPaddlePromoDiscount, archivePaddleDiscount } = require("../../common/discounts");

const CODE_RE = /^[A-Z0-9_-]{3,64}$/;
const DURATIONS = ["once", "repeating", "forever"];

/** List all promo codes (admin view). */
const listPromoCodes = async (lg) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM promo_codes ORDER BY created_at DESC"
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("listPromoCodes error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/**
 * Create a promo code.
 *  - percent_off → a real Stripe coupon + promotion code (works at Checkout).
 *  - free_plan   → an app-managed record; redeeming comps the plan (no Stripe).
 */
const createPromoCode = async (data, adminId, lg) => {
  const code = String(data?.code || "").trim().toUpperCase();
  const type = data?.type;

  if (!CODE_RE.test(code)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_promo_code", lg));
  }
  if (!["percent_off", "free_plan"].includes(type)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_promo_type", lg));
  }

  const duration = DURATIONS.includes(data?.duration) ? data.duration : "once";
  const durationMonths =
    duration === "repeating" ? Math.max(1, Number(data?.durationMonths) || 1) : null;
  const maxRedemptions = data?.maxRedemptions ? Math.max(1, Number(data.maxRedemptions)) : null;
  const expiresAt = data?.expiresAt ? new Date(data.expiresAt) : null;

  try {
    const [dup] = await pool.query("SELECT id FROM promo_codes WHERE code = ?", [code]);
    if (dup.length > 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "promo_code_taken", lg));
    }

    let appliesToPlan = null;
    let percentOff = null;
    let planGrant = null;
    let stripeCouponId = null;
    let stripePromotionCodeId = null;
    let paddleDiscountId = null;

    if (type === "percent_off") {
      percentOff = Math.max(1, Math.min(100, Number(data?.percentOff) || 0));
      if (!percentOff) {
        return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_percent", lg));
      }
      appliesToPlan = ["any", "pro", "business"].includes(data?.appliesToPlan)
        ? data.appliesToPlan
        : "any";
      // Back the code with a discount on the ACTIVE provider. It's applied at
      // checkout by id (redeemed in-app), never typed into the provider's overlay.
      if (isPaddleActive()) {
        paddleDiscountId = await createPaddlePromoDiscount({
          code,
          percentOff,
          duration,
          durationMonths,
          maxRedemptions,
          expiresAt,
          appliesToPlan,
        });
      } else {
        if (!isStripeConfigured()) {
          return Promise.reject(
            setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "stripe_not_configured", lg)
          );
        }
        const coupon = await stripe.coupons.create({
          percent_off: percentOff,
          duration,
          ...(duration === "repeating" ? { duration_in_months: durationMonths } : {}),
          name: `Promo ${code}`,
        });
        const promo = await stripe.promotionCodes.create({
          coupon: coupon.id,
          code,
          ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
          ...(expiresAt ? { expires_at: Math.floor(expiresAt.getTime() / 1000) } : {}),
        });
        stripeCouponId = coupon.id;
        stripePromotionCodeId = promo.id;
      }
    } else {
      planGrant = ["pro", "business"].includes(data?.planGrant) ? data.planGrant : null;
      if (!planGrant) {
        return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
      }
    }

    const [result] = await pool.query(
      `INSERT INTO promo_codes
         (code, type, applies_to_plan, percent_off, plan_grant, duration,
          duration_months, stripe_coupon_id, stripe_promotion_code_id,
          paddle_discount_id, max_redemptions, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        code, type, appliesToPlan, percentOff, planGrant, duration,
        durationMonths, stripeCouponId, stripePromotionCodeId,
        paddleDiscountId, maxRedemptions, expiresAt, adminId,
      ]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.CREATED, "promo_created", lg, { id: result.insertId })
    );
  } catch (error) {
    console.error("createPromoCode error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_create_promo", lg)
    );
  }
};

/** Deactivate a promo code (also disables its Stripe promotion code). */
const revokePromoCode = async (id, lg) => {
  try {
    const [rows] = await pool.query(
      "SELECT stripe_promotion_code_id, paddle_discount_id FROM promo_codes WHERE id = ?",
      [id]
    );
    if (rows.length === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "promo_not_found", lg));
    }
    if (rows[0].paddle_discount_id) {
      await archivePaddleDiscount(rows[0].paddle_discount_id);
    }
    if (rows[0].stripe_promotion_code_id && isStripeConfigured()) {
      try {
        await stripe.promotionCodes.update(rows[0].stripe_promotion_code_id, { active: false });
      } catch (e) {
        console.error("stripe promo disable failed (non-fatal):", e.message);
      }
    }
    await pool.query("UPDATE promo_codes SET is_active = 0 WHERE id = ?", [id]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "promo_revoked", lg));
  } catch (error) {
    console.error("revokePromoCode error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/**
 * Reactivate a revoked promo code, optionally with new terms.
 *
 * Revoking archives the provider discount, and an archived discount can't be
 * meaningfully un-archived — nor would it match if the terms changed. So a
 * percent-off code always gets a FRESH provider discount built from the terms it
 * is being reactivated with. The stored `code` never changes; that's the thing
 * customers already have.
 *
 * Usage history is KEPT by default: `times_redeemed` carries over and the
 * UNIQUE (promo_code_id, account_email) index still stops anyone who already
 * redeemed from doing it again. Pass `resetUsage: true` to wipe that history and
 * start the code over — that deletes redemption records, so it's opt-in.
 */
const reactivatePromoCode = async (id, data = {}, adminId, lg) => {
  try {
    const [rows] = await pool.query("SELECT * FROM promo_codes WHERE id = ?", [id]);
    if (rows.length === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "promo_not_found", lg));
    }
    const promo = rows[0];
    if (promo.is_active) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "promo_already_active", lg));
    }

    // Merge the supplied terms over the existing ones — omitted fields are kept.
    const pick = (v, fallback) => (v === undefined || v === null || v === "" ? fallback : v);
    const duration = DURATIONS.includes(data.duration) ? data.duration : promo.duration;
    const durationMonths =
      duration === "repeating"
        ? Math.max(1, Number(pick(data.durationMonths, promo.duration_months)) || 1)
        : null;
    const maxRedemptions =
      data.maxRedemptions === null || data.maxRedemptions === ""
        ? null
        : data.maxRedemptions !== undefined
          ? Math.max(1, Number(data.maxRedemptions))
          : promo.max_redemptions;
    const expiresAt =
      data.expiresAt === null || data.expiresAt === ""
        ? null
        : data.expiresAt !== undefined
          ? new Date(data.expiresAt)
          : promo.expires_at;
    const resetUsage = data.resetUsage === true;

    let percentOff = promo.percent_off;
    let appliesToPlan = promo.applies_to_plan;
    let planGrant = promo.plan_grant;
    let paddleDiscountId = null;
    let stripeCouponId = null;
    let stripePromotionCodeId = null;

    if (promo.type === "percent_off") {
      percentOff = Math.max(1, Math.min(100, Number(pick(data.percentOff, promo.percent_off)) || 0));
      if (!percentOff) {
        return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_percent", lg));
      }
      appliesToPlan = ["any", "pro", "business"].includes(data.appliesToPlan)
        ? data.appliesToPlan
        : promo.applies_to_plan || "any";

      if (isPaddleActive()) {
        paddleDiscountId = await createPaddlePromoDiscount({
          code: promo.code,
          percentOff,
          duration,
          durationMonths,
          maxRedemptions,
          expiresAt,
          appliesToPlan,
        });
      } else {
        if (!isStripeConfigured()) {
          return Promise.reject(
            setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "stripe_not_configured", lg)
          );
        }
        const coupon = await stripe.coupons.create({
          percent_off: percentOff,
          duration,
          ...(duration === "repeating" ? { duration_in_months: durationMonths } : {}),
          name: `Promo ${promo.code}`,
        });
        // Stripe requires a unique ACTIVE code; the old one is inactive, so the
        // same customer-facing code can be reused.
        const p = await stripe.promotionCodes.create({
          coupon: coupon.id,
          code: promo.code,
          ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
          ...(expiresAt ? { expires_at: Math.floor(new Date(expiresAt).getTime() / 1000) } : {}),
        });
        stripeCouponId = coupon.id;
        stripePromotionCodeId = p.id;
      }
    } else {
      planGrant = ["pro", "business"].includes(data.planGrant) ? data.planGrant : promo.plan_grant;
      if (!planGrant) {
        return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
      }
    }

    if (resetUsage) {
      await pool.query("DELETE FROM promo_redemptions WHERE promo_code_id = ?", [id]);
    }

    await pool.query(
      `UPDATE promo_codes
          SET is_active = 1,
              applies_to_plan = ?, percent_off = ?, plan_grant = ?,
              duration = ?, duration_months = ?,
              max_redemptions = ?, expires_at = ?,
              paddle_discount_id = ?, stripe_coupon_id = ?, stripe_promotion_code_id = ?,
              times_redeemed = ${resetUsage ? "0" : "times_redeemed"},
              created_by = COALESCE(?, created_by)
        WHERE id = ?`,
      [
        appliesToPlan, percentOff, planGrant,
        duration, durationMonths,
        maxRedemptions, expiresAt,
        paddleDiscountId, stripeCouponId, stripePromotionCodeId,
        adminId || null, id,
      ]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "promo_reactivated", lg, { id: Number(id) })
    );
  } catch (error) {
    console.error("reactivatePromoCode error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "failed_to_create_promo", lg)
    );
  }
};

module.exports = { listPromoCodes, createPromoCode, revokePromoCode, reactivatePromoCode };
