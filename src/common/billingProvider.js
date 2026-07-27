/**
 * Which payment provider is ACTIVE. `paddle` (Merchant of Record) is the default;
 * `stripe` is kept dormant and re-selectable via BILLING_PROVIDER=stripe. The
 * billing routes + accountBilling.reconcileAccount + admin comp path dispatch on
 * this so both implementations can coexist.
 */
const getBillingProvider = () =>
  process.env.BILLING_PROVIDER === "stripe" ? "stripe" : "paddle";

const isPaddleActive = () => getBillingProvider() === "paddle";

module.exports = { getBillingProvider, isPaddleActive };
