/**
 * Import database/schema.sql into the configured database.
 *
 *   node scripts/import-schema.js
 *
 * Uses the app's own mysql2 dependency and DB_* env vars, so it runs anywhere
 * the app runs -- including a container terminal with no `mysql` client
 * installed (Dokploy, Railway, Fly).
 *
 * Safe to re-run: every statement in schema.sql is CREATE TABLE IF NOT EXISTS,
 * and the file contains no INSERT and no DROP. It never touches existing rows.
 *
 * Do NOT point this at feedboard_db.sql (repo root) -- that is the development
 * dump and ends in a dummy seed block (fake tenants/users sharing one bcrypt
 * hash). See the header of database/schema.sql.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const SCHEMA_PATH = path.join(__dirname, "..", "database", "schema.sql");

(async () => {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

  const missing = ["DB_HOST", "DB_USER", "DB_NAME"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    process.exit(1);
  }
  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`Schema file not found: ${SCHEMA_PATH}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(SCHEMA_PATH, "utf8");
  if (/^\s*INSERT/im.test(sql)) {
    console.error("Refusing to run: schema file contains INSERT statements.");
    process.exit(1);
  }

  console.log(`Connecting to ${DB_USER}@${DB_HOST}:${DB_PORT || 3306}/${DB_NAME} …`);
  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT) || 3306,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    // schema.sql is one script of many statements.
    multipleStatements: true,
  });

  const [before] = await conn.query("SHOW TABLES");
  console.log(`Tables before: ${before.length}`);

  await conn.query(sql);

  const [after] = await conn.query("SHOW TABLES");
  const names = after.map((r) => Object.values(r)[0]).sort();
  console.log(`Tables after:  ${after.length}`);
  console.log(names.join(" "));

  await conn.end();
  console.log(
    before.length === after.length
      ? "\nNo change — schema was already present."
      : `\nDone. Created ${after.length - before.length} table(s).`
  );
  console.log("Next: node scripts/create-admin.js <email> <password> \"Name\"");
})().catch((e) => {
  console.error("Import failed:", e.message);
  process.exit(1);
});
