/**
 * Adds the columns that record a SCHEDULED plan change (a downgrade that takes
 * effect at the end of the paid period, held as a Stripe Subscription Schedule).
 * The Billing tab shows "changes to <plan> on <date>". Idempotent. Mirrored in
 * feedboard_db.sql.
 *
 *   node scripts/add-pending-plan.js
 */
require("dotenv").config();
const { pool } = require("../database/dbPool");

const hasColumn = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
};

(async () => {
  try {
    const adds = [
      ["pending_plan", "ADD COLUMN pending_plan VARCHAR(20) NULL AFTER current_period_end"],
      ["pending_interval", "ADD COLUMN pending_interval ENUM('month','year') NULL AFTER pending_plan"],
      ["pending_effective_at", "ADD COLUMN pending_effective_at DATETIME NULL AFTER pending_interval"],
    ];
    for (const [col, clause] of adds) {
      if (await hasColumn("tenants", col)) {
        console.log(`tenants.${col} already exists — skipping`);
      } else {
        await pool.query(`ALTER TABLE tenants ${clause}`);
        console.log(`added tenants.${col}`);
      }
    }
    await pool.end();
  } catch (e) {
    console.error("migration error:", e.message);
    process.exit(1);
  }
})();
