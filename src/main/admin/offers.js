const { pool } = require("../../../database/dbPool");
const { API_STATUS_CODE } = require("../../consts/errorStatus");
const { setServerResponse } = require("../../common/setServerResponse");
const { stripe, isStripeConfigured } = require("../../common/stripe");
const { isPaddleActive } = require("../../common/billingProvider");
const { createPaddleOfferDiscount, archivePaddleDiscount } = require("../../common/discounts");
const { offerDurationPeriods } = require("../../common/offers");
const { listPrice } = require("../../consts/plans");

const OFFER_PLANS = ["pro", "business"];
const OFFER_INTERVALS = ["month", "year"];

/** List all offers (admin view). */
const listOffers = async (lg) => {
  try {
    const [rows] = await pool.query("SELECT * FROM offers ORDER BY created_at DESC");
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.OK, "admin_data_retrieved", lg, { rows })
    );
  } catch (error) {
    console.error("listOffers error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/**
 * Create a promotional offer for a paid plan on a given interval (monthly or
 * yearly). The offer sets a lower shown price and is backed by a Stripe
 * amount-off coupon auto-applied at checkout, so customers actually pay the
 * offer price. Only one active offer per (plan, interval) — for a yearly offer
 * the price and list baseline are the yearly TOTALs.
 */
const createOffer = async (data, adminId, lg) => {
  const plan = data?.plan;
  if (!OFFER_PLANS.includes(plan)) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_plan", lg));
  }
  const interval = OFFER_INTERVALS.includes(data?.interval) ? data.interval : "month";
  const originalPrice = listPrice(plan, interval);
  const offerPrice = Number(data?.offerPrice);
  if (!(offerPrice > 0) || offerPrice >= originalPrice) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_offer_price", lg));
  }
  const percentOff = Math.round((1 - offerPrice / originalPrice) * 100);
  if (percentOff < 1 || percentOff > 100) {
    return Promise.reject(setServerResponse(API_STATUS_CODE.BAD_REQUEST, "invalid_offer_price", lg));
  }

  const label = String(data?.label || "").trim().slice(0, 120) || null;
  // Store bounds as LOCAL DATETIME strings (no Date/timezone conversion — a Date
  // would be shifted to UTC by the pool and land the offer hours off). Accept a
  // `datetime-local` value ("YYYY-MM-DDTHH:mm[:ss]") verbatim, or a date-only
  // value which becomes the start / end of that local day.
  /**
   * Normalise an admin-supplied start/end into something `starts_at <= NOW()`
   * can be compared against — NOW() being the DB SERVER's clock.
   *
   * A ZONED value (…Z or ±HH:MM) names an exact instant, so it is returned as a
   * Date and mysql2 (pool `timezone: "local"`) writes it in the server's zone.
   * That is the path the admin UI uses.
   *
   * Previously every value was treated as naive wall-clock text: "T" was swapped
   * for a space and stored as-is. An admin in UTC+6 picking "now" therefore got
   * an offer that only began SIX HOURS LATER — it simply never appeared on the
   * pricing page, with is_active = 1 and nothing in the logs. Invisible in dev,
   * where the browser and the database share a timezone.
   *
   * Naive input is still accepted (older clients, a hand-written date) and keeps
   * the old meaning: server-local wall clock.
   */
  const toLocalDateTime = (v, endOfDayIfDateOnly) => {
    if (!v) return null;
    const s = String(v).trim();

    if (/(Z|[+-]\d{2}:\d{2})$/.test(s)) {
      const d = new Date(s);
      if (!Number.isNaN(d.getTime())) return d;
    }

    if (s.includes("T")) {
      const dt = s.replace("T", " ");
      return (dt.length === 16 ? `${dt}:00` : dt).slice(0, 19);
    }
    const day = s.slice(0, 10);
    return endOfDayIfDateOnly ? `${day} 23:59:59` : `${day} 00:00:00`;
  };
  const startsAt = toLocalDateTime(data?.startsAt, false);
  const endsAt = toLocalDateTime(data?.endsAt, true);

  try {
    // Back the offer with a discount on the ACTIVE provider, auto-applied at
    // checkout so the customer pays the offer price exactly. Fixed amount-off (not
    // percent) so a fractional offer price bills EXACTLY — e.g. $12.50 off a $15
    // plan bills $12.50, not a rounded ~17%. Non-fatal: the offer still records.
    let stripeCouponId = null;
    let paddleDiscountId = null;
    if (isPaddleActive()) {
      try {
        paddleDiscountId = await createPaddleOfferDiscount({
          plan, interval, originalPrice, offerPrice,
          // The offer window decides how long a buyer keeps the price.
          durationPeriods: offerDurationPeriods(interval, startsAt, endsAt),
        });
      } catch (e) {
        console.error("offer paddle discount create failed (non-fatal):", e.message);
      }
    } else if (isStripeConfigured()) {
      try {
        const amountOff = Math.round((originalPrice - offerPrice) * 100);
        const coupon = await stripe.coupons.create({
          amount_off: amountOff,
          currency: "usd",
          duration: "forever",
          name: `Offer ${plan} ${interval} $${offerPrice.toFixed(2)}`,
        });
        stripeCouponId = coupon.id;
      } catch (e) {
        console.error("offer coupon create failed (non-fatal):", e.message);
      }
    }

    // Only one active offer per (plan, interval).
    await pool.query(
      "UPDATE offers SET is_active = 0 WHERE plan = ? AND billing_interval = ? AND is_active = 1",
      [plan, interval]
    );

    const [result] = await pool.query(
      `INSERT INTO offers (plan, billing_interval, offer_price, label, starts_at, ends_at, stripe_coupon_id, paddle_discount_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [plan, interval, offerPrice, label, startsAt, endsAt, stripeCouponId, paddleDiscountId, adminId]
    );
    return Promise.resolve(
      setServerResponse(API_STATUS_CODE.CREATED, "offer_created", lg, { id: result.insertId })
    );
  } catch (error) {
    console.error("createOffer error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

/** Deactivate an offer (also deletes its Stripe coupon). */
const deactivateOffer = async (id, lg) => {
  try {
    const [rows] = await pool.query(
      "SELECT stripe_coupon_id, paddle_discount_id FROM offers WHERE id = ?",
      [id]
    );
    if (rows.length === 0) {
      return Promise.reject(setServerResponse(API_STATUS_CODE.NOT_FOUND, "offer_not_found", lg));
    }
    if (rows[0].paddle_discount_id) {
      await archivePaddleDiscount(rows[0].paddle_discount_id);
    }
    if (rows[0].stripe_coupon_id && isStripeConfigured()) {
      try {
        await stripe.coupons.del(rows[0].stripe_coupon_id);
      } catch (e) {
        console.error("offer coupon delete failed (non-fatal):", e.message);
      }
    }
    await pool.query("UPDATE offers SET is_active = 0 WHERE id = ?", [id]);
    return Promise.resolve(setServerResponse(API_STATUS_CODE.OK, "offer_deactivated", lg));
  } catch (error) {
    console.error("deactivateOffer error:", error);
    return Promise.reject(
      setServerResponse(API_STATUS_CODE.INTERNAL_SERVER_ERROR, "internal_server_error", lg)
    );
  }
};

module.exports = { listOffers, createOffer, deactivateOffer };
