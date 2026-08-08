const path = require("path");
const { spawn } = require("child_process");
const { pool } = require("../../database/dbPool");

/**
 * Run pending schema migrations at boot, before the server accepts traffic.
 *
 * WHY THIS EXISTS — a real outage, 8 Aug 2026. A release added
 * `WHERE p.moderation_state <> 'spam'` to the public board query. The code
 * deployed; `scripts/add-spam-columns.js` did not run. MySQL rejected every
 * query with "Unknown column", getPublicBoard swallowed it into its generic
 * "Failed to retrieve posts", and EVERY public board on the platform was down
 * until a customer's missing post happened to get noticed hours later.
 *
 * The requirement to run that script lived in a chat message and a docs line.
 * Prose doesn't execute. A schema-dependent code change has to carry its own
 * migration or the two will drift apart on exactly the deploy where it matters.
 *
 * SAFE BECAUSE THE SCRIPTS ARE:
 *   - idempotent — each checks information_schema before altering, and a re-run
 *     prints "already exists" (verified);
 *   - additive — ADD COLUMN / ADD KEY / CREATE TABLE IF NOT EXISTS only.
 *
 * **Keep migrations additive.** The moment one drops or rewrites data, running
 * it automatically on every boot stops being safe, and this list must gain an
 * explicit opt-out rather than being pointed at it.
 *
 * CLUSTER SAFETY: PM2 runs one worker per core, so without coordination N
 * workers would ALTER the same table concurrently and lose the
 * check-then-add race ("Duplicate column name"). Same MySQL advisory lock the
 * billing scheduler uses — the winner migrates, the rest wait for it to finish
 * and then proceed, so nobody serves traffic against a half-migrated schema.
 */

const LOCK_NAME = "feedboard_boot_migrations";
/** Generous: an ALTER on a large table can take a while, and every other worker is waiting. */
const LOCK_TIMEOUT_SECONDS = 120;

/**
 * Ordered, and additive-only. A script added here runs on every deploy, so it
 * must be safe to run against an already-migrated database.
 */
const MIGRATIONS = [
  "add-spam-columns.js",
  "add-spam-review-columns.js",
];

const runScript = (file) =>
  new Promise((resolve, reject) => {
    const full = path.join(__dirname, "..", "..", "scripts", file);
    // A child process, not require(): each script ends with pool.end(), which
    // would tear down the shared pool the server is about to serve from.
    const child = spawn(process.execPath, [full], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${file} exited ${code}\n${out}`))
    );
  });

/**
 * @returns {Promise<boolean>} true when the schema is known-good to serve on.
 *   FALSE IS FATAL to the caller — see app.js. Booting anyway is what turned a
 *   missed migration into a silent platform-wide outage last time.
 */
async function runBootMigrations() {
  if (process.env.SKIP_BOOT_MIGRATIONS === "true") {
    console.log("Boot migrations skipped (SKIP_BOOT_MIGRATIONS=true).");
    return true;
  }

  let conn;
  try {
    conn = await pool.getConnection();
  } catch (e) {
    console.error("Boot migrations: no database connection —", e.message);
    return false;
  }

  try {
    // Blocking acquire: a loser must not race ahead and serve traffic while the
    // winner is still altering tables.
    const [[got]] = await conn.query("SELECT GET_LOCK(?, ?) AS ok", [
      LOCK_NAME,
      LOCK_TIMEOUT_SECONDS,
    ]);
    if (!got || Number(got.ok) !== 1) {
      console.error(
        `Boot migrations: could not acquire lock within ${LOCK_TIMEOUT_SECONDS}s.`
      );
      return false;
    }

    try {
      for (const file of MIGRATIONS) {
        const out = await runScript(file);
        // Only log real work; a fully-migrated boot is the common case and
        // shouldn't add noise to every restart.
        //
        // Match the change lines EXACTLY. A loose `.*ready` also matches
        // "al-ready exists — skipping", which reported "13 changes applied" on
        // a boot that changed 3 things — misleading noise in the one log line
        // that exists to tell you whether a deploy needed a migration.
        const changed = out
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^added /i.test(l) || /\bready$/i.test(l));
        if (changed.length) {
          console.log(`Migration ${file}: ${changed.length} change(s) applied`);
          changed.forEach((l) => console.log(`  ${l.trim()}`));
        }
      }
      console.log("Schema up to date.");
      return true;
    } finally {
      await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
    }
  } catch (error) {
    console.error("Boot migrations FAILED:", error.message);
    return false;
  } finally {
    conn.release();
  }
}

module.exports = { runBootMigrations };
