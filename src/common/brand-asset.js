const fs = require("fs");
const path = require("path");

/**
 * FeedBoard's own brand icon (the rose speech-bubble app icon). The canonical
 * source lives in the repo at `assets/app-icon.svg`; it is copied into the
 * static uploads tree so it is served just like any uploaded avatar/logo and can
 * be stored as an ordinary `avatar_url` / `branding_logo_url` value.
 *
 * Used as:
 *   - the platform admin's profile picture (`users.avatar_url`)
 *   - the official feedback board's logo (`tenants.branding_logo_url`)
 * so the admin's comments show the app icon as their avatar (via `author_avatar`)
 * and the official board renders the app icon.
 */
const BRAND_LOGO_PATH = "uploads/branding/app-icon.svg";

/**
 * Ensure the brand icon exists in the served uploads tree (idempotent). Returns
 * the backend-relative path (`BRAND_LOGO_PATH`) suitable for storing in the DB.
 */
const ensureBrandAsset = () => {
  const src = path.join(process.cwd(), "assets", "app-icon.svg");
  const destDir = path.join(process.cwd(), "uploads", "branding");
  const dest = path.join(destDir, "app-icon.svg");
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  return BRAND_LOGO_PATH;
};

module.exports = { BRAND_LOGO_PATH, ensureBrandAsset };
