SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS feedboard_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE feedboard_db;

CREATE TABLE IF NOT EXISTS tenants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  subdomain VARCHAR(120) NOT NULL,
  custom_domain VARCHAR(255) NULL,
  -- The company's website (informational); NOT the unique portal custom_domain.
  website VARCHAR(255) NULL,
  -- Effective plan of this workspace = its OWNER's account plan, MIRRORED here
  -- from billing_accounts (see src/common/accountBilling.js). Subscriptions are
  -- per-account, not per-workspace; these columns are a denormalized copy so the
  -- many readers of tenants.plan_name keep working. The tenant-level Stripe ids
  -- are legacy/unused (billing lives on billing_accounts) and stay NULL.
  plan_name VARCHAR(50) NOT NULL DEFAULT 'free',
  -- Legacy Stripe columns — no longer the source of truth (kept for history).
  stripe_customer_id VARCHAR(255) NULL,
  stripe_subscription_id VARCHAR(255) NULL,
  subscription_status VARCHAR(50) NULL,
  -- Billing interval of the active subscription ('month' | 'year'); NULL on free.
  billing_interval ENUM('month', 'year') NULL,
  current_period_end DATETIME NULL,
  -- A SCHEDULED plan change (a downgrade at period end, held as a Stripe
  -- Subscription Schedule). Shown as "changes to <plan> on <date>".
  pending_plan VARCHAR(20) NULL,
  pending_interval ENUM('month', 'year') NULL,
  pending_effective_at DATETIME NULL,
  branding_logo_url VARCHAR(500) NULL,
  branding_primary_color VARCHAR(20) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_slug (slug),
  UNIQUE KEY uq_tenants_subdomain (subdomain),
  UNIQUE KEY uq_tenants_custom_domain (custom_domain)
) ENGINE=InnoDB;

-- Per-ACCOUNT subscription (keyed by email — the account identity). One account
-- pays once and its plan covers EVERY workspace it owns; the plan is mirrored to
-- each owned tenants.plan_name. This table is the billing source of truth. The
-- ACTIVE payment provider is chosen by BILLING_PROVIDER (paddle | stripe); each
-- provider keeps its own customer/subscription ids while the plan/status/interval/
-- period/pending columns stay provider-agnostic. See accountBilling.js.
CREATE TABLE IF NOT EXISTS billing_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  plan_name VARCHAR(50) NOT NULL DEFAULT 'free',
  -- Stripe ids (dormant when BILLING_PROVIDER=paddle; kept for a later switch back).
  stripe_customer_id VARCHAR(255) NULL,
  stripe_subscription_id VARCHAR(255) NULL,
  -- Paddle ids (the active Merchant-of-Record provider).
  paddle_customer_id VARCHAR(255) NULL,
  paddle_subscription_id VARCHAR(255) NULL,
  subscription_status VARCHAR(50) NULL,
  billing_interval ENUM('month', 'year') NULL,
  current_period_end DATETIME NULL,
  -- A SCHEDULED plan change (downgrade at period end), same semantics as tenants.
  pending_plan VARCHAR(20) NULL,
  pending_interval ENUM('month', 'year') NULL,
  pending_effective_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_accounts_email (email),
  KEY idx_billing_accounts_customer (stripe_customer_id),
  KEY idx_billing_accounts_subscription (stripe_subscription_id),
  KEY idx_billing_accounts_paddle_customer (paddle_customer_id),
  KEY idx_billing_accounts_paddle_subscription (paddle_subscription_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  -- NULL until the account creates/joins its first workspace (onboarding).
  tenant_id BIGINT UNSIGNED NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NULL,
  full_name VARCHAR(150) NOT NULL,
  contact_no VARCHAR(20) NULL,
  -- Tenant roles: 'owner' manages the workspace, 'user' is a member.
  role ENUM('owner', 'user') NOT NULL DEFAULT 'user',
  -- Platform-admin ROLE (the app operator). Keyed by email across the account's
  -- rows; authenticated at /admin-login. A normal login (/login) ignores it.
  is_platform_admin TINYINT(1) NOT NULL DEFAULT 0,
  avatar_url VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  KEY idx_users_tenant_role (tenant_id, role),
  KEY idx_users_platform_admin (is_platform_admin),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Platform admin is a ROLE on a `users` account (users.is_platform_admin), not a
-- separate table. The same email can be a normal tenant customer AND a platform
-- admin; /admin-login checks the flag and issues a scope='admin' JWT
-- (src/main/admin/adminLogin.js). Bootstrap with scripts/create-admin.js.

-- Admin-generated promo codes. `percent_off` codes are backed by a Stripe
-- coupon + promotion code (applied at Checkout); `free_plan` codes are
-- app-managed comps (redeeming grants the plan with no Stripe/charge).
CREATE TABLE IF NOT EXISTS promo_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  type ENUM('percent_off', 'free_plan') NOT NULL,
  applies_to_plan ENUM('any', 'pro', 'business') NULL,
  percent_off TINYINT UNSIGNED NULL,
  plan_grant ENUM('pro', 'business') NULL,
  duration ENUM('once', 'repeating', 'forever') NOT NULL DEFAULT 'once',
  duration_months INT UNSIGNED NULL,
  stripe_coupon_id VARCHAR(255) NULL,
  stripe_promotion_code_id VARCHAR(255) NULL,
  max_redemptions INT UNSIGNED NULL,
  times_redeemed INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_promo_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS promo_redemptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  promo_code_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  redeemed_by_user_id BIGINT UNSIGNED NULL,
  plan_granted VARCHAR(50) NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_promo_redemptions_code (promo_code_id),
  KEY idx_promo_redemptions_tenant (tenant_id),
  CONSTRAINT fk_promo_redemptions_code FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE,
  CONSTRAINT fk_promo_redemptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Admin-set promotional prices on a paid plan. One active offer per plan; backed
-- by a Stripe percent-off coupon auto-applied at checkout. The Billing tab shows
-- the plan's list price with a diagonal strike + the offer price.
CREATE TABLE IF NOT EXISTS offers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  plan ENUM('pro', 'business') NOT NULL,
  billing_interval ENUM('month', 'year') NOT NULL DEFAULT 'month',
  offer_price DECIMAL(10,2) NOT NULL,
  label VARCHAR(120) NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  stripe_coupon_id VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_offers_active (plan, billing_interval, is_active)
) ENGINE=InnoDB;

-- Email invitations to join a workspace as a member. The token is the one-time
-- credential in the emailed link: single-use (status flips to 'accepted') and
-- time-boxed (expires_at). Revoking kills the link immediately.
CREATE TABLE IF NOT EXISTS invitations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(190) NOT NULL,
  token VARCHAR(128) NOT NULL,
  -- Invitees always join as members; a workspace has exactly one owner.
  role ENUM('user') NOT NULL DEFAULT 'user',
  invited_by BIGINT UNSIGNED NULL,
  status ENUM('pending', 'accepted', 'revoked') NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  accepted_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invitations_token (token),
  KEY idx_invitations_tenant_status (tenant_id, status),
  KEY idx_invitations_email (email),
  CONSTRAINT fk_invitations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Self-service password reset. Stores a SHA-256 HASH of the emailed token (never
-- the raw token — a DB read must not grant reset ability), keyed by account
-- EMAIL. Tokens are single-use and expire after 1 hour.
CREATE TABLE IF NOT EXISTS password_resets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  status ENUM('pending', 'used') NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  requested_ip VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_password_resets_token (token_hash),
  KEY idx_password_resets_email (email, status)
) ENGINE=InnoDB;

-- Device sessions — the mechanism behind "one device at a time".
-- Every issued user JWT carries an `sid` claim pointing here; `authenticateToken`
-- rejects a token whose session was revoked, so a session can be killed
-- server-side without waiting for the JWT to expire.
--
-- Keyed by EMAIL, not user id: one person may hold a row in several tenants, and
-- switching workspaces must not read as signing in on a new device.
--
-- On plans without the `multiDevice` limit (Free, Pro) a second login is refused
-- while a session is still live. A session not seen for 15 minutes counts as
-- abandoned and is taken over by the next login (which revokes it) — otherwise
-- closing the browser without signing out would lock the account out for good.
CREATE TABLE IF NOT EXISTS user_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id VARCHAR(64) NOT NULL,
  email VARCHAR(190) NOT NULL,
  user_agent VARCHAR(255) NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_sessions_sid (session_id),
  KEY idx_user_sessions_email (email, revoked_at, last_seen_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('google', 'github', 'microsoft') NOT NULL,
  provider_user_id VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_oauth_provider_user (tenant_id, provider, provider_user_id),
  KEY idx_oauth_user (tenant_id, user_id),
  CONSTRAINT fk_oauth_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_oauth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS posts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  -- author_id is NULL for guest submissions from the public portal; those carry
  -- submitter_name/email instead.
  author_id BIGINT UNSIGNED NULL,
  submitter_name VARCHAR(120) NULL,
  submitter_email VARCHAR(255) NULL,
  -- Persistent per-browser id for guest submissions, used to give one guest a
  -- single stable pseudonymous identity (name + colour) across the portal.
  guest_id VARCHAR(64) NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  post_type ENUM('feedback', 'feature_request', 'bug_report') NOT NULL DEFAULT 'feedback',
  -- 'rejected' = feedback the team declined; hidden from the public portal,
  -- shown in the dashboard "All" tab and its own Rejected tab (restorable to open).
  status ENUM('open', 'planned', 'in_progress', 'completed', 'closed', 'rejected') NOT NULL DEFAULT 'open',
  -- When the owner sent the "your feedback is implemented" email to the submitter
  -- (Pro+ contactSubmitter feature); NULL until notified.
  implemented_notified_at DATETIME NULL,
  priority TINYINT UNSIGNED NOT NULL DEFAULT 3,
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  duplicate_of_post_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_posts_tenant_status (tenant_id, status),
  KEY idx_posts_tenant_created (tenant_id, created_at),
  KEY idx_posts_duplicate (duplicate_of_post_id),
  CONSTRAINT fk_posts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_posts_duplicate FOREIGN KEY (duplicate_of_post_id) REFERENCES posts(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS votes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  post_id BIGINT UNSIGNED NOT NULL,
  -- Authenticated votes set user_id; anonymous portal votes set guest_id (a
  -- persistent per-browser cookie value) instead. Exactly one is non-null.
  user_id BIGINT UNSIGNED NULL,
  guest_id VARCHAR(64) NULL,
  vote_type ENUM('upvote') NOT NULL DEFAULT 'upvote',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_votes_unique (tenant_id, post_id, user_id),
  UNIQUE KEY uq_votes_guest (tenant_id, post_id, guest_id),
  KEY idx_votes_post (tenant_id, post_id),
  CONSTRAINT fk_votes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  post_id BIGINT UNSIGNED NOT NULL,
  -- author_id is NULL for anonymous public-portal comments; those carry
  -- submitter_name/email instead.
  author_id BIGINT UNSIGNED NULL,
  submitter_name VARCHAR(120) NULL,
  submitter_email VARCHAR(255) NULL,
  -- Persistent per-browser id for guest comments → one stable pseudonymous
  -- identity (name + colour) per guest across the portal.
  guest_id VARCHAR(64) NULL,
  -- Board OWNER chose to show as "Owner" (+ verified tick) instead of their real
  -- name. Read handlers then hide the real name/avatar for this comment.
  as_owner TINYINT(1) NOT NULL DEFAULT 0,
  parent_comment_id BIGINT UNSIGNED NULL,
  body TEXT NOT NULL,
  is_edited TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comments_post (tenant_id, post_id, created_at),
  KEY idx_comments_parent (parent_comment_id),
  CONSTRAINT fk_comments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_parent FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(60) NOT NULL,
  color_hex VARCHAR(7) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_tenant_name (tenant_id, name),
  CONSTRAINT fk_tags_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  post_id BIGINT UNSIGNED NOT NULL,
  tag_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_post_tags_unique (tenant_id, post_id, tag_id),
  CONSTRAINT fk_post_tags_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_post_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roadmap_columns (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  column_key VARCHAR(40) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roadmap_column_key (tenant_id, column_key),
  KEY idx_roadmap_columns_order (tenant_id, sort_order),
  CONSTRAINT fk_roadmap_columns_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roadmap_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  post_id BIGINT UNSIGNED NOT NULL,
  roadmap_column_id BIGINT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  target_release_date DATE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roadmap_post_unique (tenant_id, post_id),
  KEY idx_roadmap_items_column_order (tenant_id, roadmap_column_id, sort_order),
  CONSTRAINT fk_roadmap_items_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_roadmap_items_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_roadmap_items_column FOREIGN KEY (roadmap_column_id) REFERENCES roadmap_columns(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS changelog_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  summary TEXT NULL,
  content LONGTEXT NOT NULL,
  published_at DATETIME NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_changelog_tenant_published (tenant_id, is_published, published_at),
  CONSTRAINT fk_changelog_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_changelog_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  notification_type ENUM('post_status', 'comment_reply', 'mention', 'changelog', 'system', 'new_feedback') NOT NULL,
  title VARCHAR(160) NOT NULL,
  message TEXT NULL,
  -- Structured pieces of the notification text (e.g. {"key":"comment",...}) so
  -- the client can render it in the READER's language. title/message above stay
  -- as the English fallback for rows written before this column existed.
  meta JSON NULL,
  reference_type VARCHAR(50) NULL,
  reference_id BIGINT UNSIGNED NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_notifications_user_read (tenant_id, user_id, is_read, created_at),
  CONSTRAINT fk_notifications_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  key_name VARCHAR(100) NOT NULL,
  key_prefix VARCHAR(20) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  scopes JSON NULL,
  last_used_at DATETIME NULL,
  expires_at DATETIME NULL,
  is_revoked TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_hash (key_hash),
  KEY idx_api_keys_tenant (tenant_id),
  CONSTRAINT fk_api_keys_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_api_keys_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(120) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  metadata JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_tenant_created (tenant_id, created_at),
  KEY idx_audit_actor (tenant_id, actor_user_id),
  CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS integrations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  integration_type ENUM('slack', 'discord', 'webhook', 'zapier') NOT NULL,
  config JSON NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_integrations_tenant_type (tenant_id, integration_type),
  CONSTRAINT fk_integrations_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Photo/video attachments on a feedback post. A paid-plan (Pro+) capability.
-- Deliberately guest-friendly: unlike file_uploads there is NO uploader FK, so a
-- visitor submitting on the public board can attach without an account.
-- `post_id` is NULL between upload and submit: the file is stored first, then
-- linked to the post it was created with (unlinked rows are orphans to prune).
CREATE TABLE IF NOT EXISTS post_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  post_id BIGINT UNSIGNED NULL,
  kind ENUM('image', 'video') NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_post_attachments_post (post_id),
  KEY idx_post_attachments_pending (tenant_id, post_id, created_at),
  CONSTRAINT fk_post_attachments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_post_attachments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS file_uploads (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  related_entity_type VARCHAR(60) NULL,
  related_entity_id BIGINT UNSIGNED NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_uploads_tenant_entity (tenant_id, related_entity_type, related_entity_id),
  CONSTRAINT fk_uploads_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_uploads_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Support chat: a conversation between ONE tenant user and the platform admin.
-- Session-based — the admin closes a session when done. Once closed the user
-- can no longer see it, but the admin keeps the transcript forever, so nothing
-- here cascades from users/tenants: user_id/tenant_id are SET NULL on delete and
-- the display identity is denormalized (user_email/user_name) to survive it.
CREATE TABLE IF NOT EXISTS support_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  user_email VARCHAR(255) NOT NULL,
  user_name VARCHAR(160) NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at DATETIME NULL,
  user_last_read_at DATETIME NULL,
  admin_last_read_at DATETIME NULL,
  closed_at DATETIME NULL,
  closed_by_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_support_sessions_user_status (user_id, status),
  KEY idx_support_sessions_status_last (status, last_message_at),
  CONSTRAINT fk_support_sessions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL,
  CONSTRAINT fk_support_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_support_sessions_admin FOREIGN KEY (closed_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id BIGINT UNSIGNED NOT NULL,
  sender ENUM('user', 'admin') NOT NULL,
  sender_user_id BIGINT UNSIGNED NULL,
  sender_admin_id BIGINT UNSIGNED NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_messages_session (session_id, created_at),
  CONSTRAINT fk_support_messages_session FOREIGN KEY (session_id) REFERENCES support_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_support_messages_user FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_support_messages_admin FOREIGN KEY (sender_admin_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- -----------------------------------------------------
-- Dummy seed data
-- -----------------------------------------------------

INSERT IGNORE INTO tenants (
  id, name, slug, subdomain, custom_domain, plan_name, branding_logo_url, branding_primary_color, is_active
) VALUES
  (1, 'Acme Labs', 'acme-labs', 'acme', 'feedback.acme.test', 'pro', NULL, '#c74959', 1),
  (2, 'Beta Works', 'beta-works', 'beta', NULL, 'free', NULL, '#10B981', 1);

INSERT IGNORE INTO users (
  id, tenant_id, email, password_hash, full_name, contact_no, role, avatar_url, is_active, last_login_at
) VALUES
  (1, 1, 'owner@acme.test', '$2b$10$NjICKEPJAgWeXAmkkwxq2.XtQsbnWJ329UbY5.nVqDOxCdWvcXp.C', 'Acme Owner', '+8801712340001', 'owner', 'https://cdn.example.com/avatar/owner.png', 1, NOW()),
  (2, 1, 'admin@acme.test', '$2b$10$NjICKEPJAgWeXAmkkwxq2.XtQsbnWJ329UbY5.nVqDOxCdWvcXp.C', 'Acme Admin', '+8801712340002', 'admin', 'https://cdn.example.com/avatar/admin.png', 1, NOW()),
  (3, 1, 'jane@acme.test', '$2b$10$NjICKEPJAgWeXAmkkwxq2.XtQsbnWJ329UbY5.nVqDOxCdWvcXp.C', 'Jane Product', '+8801712340003', 'user', NULL, 1, NOW()),
  (4, 2, 'owner@beta.test', '$2b$10$NjICKEPJAgWeXAmkkwxq2.XtQsbnWJ329UbY5.nVqDOxCdWvcXp.C', 'Beta Owner', '+8801712340004', 'owner', NULL, 1, NOW());

INSERT IGNORE INTO oauth_accounts (
  id, tenant_id, user_id, provider, provider_user_id
) VALUES
  (1, 1, 1, 'google', 'google-owner-001'),
  (2, 1, 3, 'github', 'github-jane-001');

INSERT IGNORE INTO posts (
  id, tenant_id, author_id, title, description, post_type, status, priority, is_pinned, duplicate_of_post_id
) VALUES
  (1, 1, 3, 'Add dark mode', 'Please add dark mode support for the dashboard.', 'feature_request', 'planned', 2, 1, NULL),
  (2, 1, 2, 'Export feedback as CSV', 'Need CSV export from admin panel.', 'feature_request', 'in_progress', 3, 0, NULL),
  (3, 1, 3, 'Login button overlaps on mobile', 'UI overlap happens on iPhone SE viewport.', 'bug_report', 'open', 1, 0, NULL),
  (4, 1, 3, 'Dark mode toggle missing', 'Likely duplicate of dark mode request.', 'feedback', 'open', 4, 0, 1),
  (5, 2, 4, 'Roadmap visibility controls', 'Allow private roadmap columns.', 'feature_request', 'open', 3, 0, NULL);

INSERT IGNORE INTO votes (
  id, tenant_id, post_id, user_id, vote_type
) VALUES
  (1, 1, 1, 1, 'upvote'),
  (2, 1, 1, 2, 'upvote'),
  (3, 1, 2, 3, 'upvote'),
  (4, 1, 3, 1, 'upvote'),
  (5, 2, 5, 4, 'upvote');

INSERT IGNORE INTO comments (
  id, tenant_id, post_id, author_id, parent_comment_id, body, is_edited
) VALUES
  (1, 1, 1, 1, NULL, 'Great request, we need this for night shifts.', 0),
  (2, 1, 1, 2, 1, 'Agreed, this is already in planning.', 0),
  (3, 1, 3, 3, NULL, 'I can consistently reproduce this bug.', 1),
  (4, 2, 5, 4, NULL, 'Would help enterprise customers a lot.', 0);

INSERT IGNORE INTO tags (
  id, tenant_id, name, color_hex
) VALUES
  (1, 1, 'ui', '#3B82F6'),
  (2, 1, 'bug', '#EF4444'),
  (3, 1, 'high-priority', '#F59E0B'),
  (4, 2, 'roadmap', '#10B981');

INSERT IGNORE INTO post_tags (
  id, tenant_id, post_id, tag_id
) VALUES
  (1, 1, 1, 1),
  (2, 1, 3, 2),
  (3, 1, 3, 3),
  (4, 2, 5, 4);

INSERT IGNORE INTO roadmap_columns (
  id, tenant_id, name, column_key, sort_order
) VALUES
  (1, 1, 'Planned', 'planned', 1),
  (2, 1, 'In Progress', 'in_progress', 2),
  (3, 1, 'Completed', 'completed', 3),
  (4, 2, 'Backlog', 'backlog', 1);

INSERT IGNORE INTO roadmap_items (
  id, tenant_id, post_id, roadmap_column_id, sort_order, target_release_date
) VALUES
  (1, 1, 1, 1, 1, '2026-06-01'),
  (2, 1, 2, 2, 1, '2026-05-15'),
  (3, 2, 5, 4, 1, '2026-07-10');

INSERT IGNORE INTO changelog_entries (
  id, tenant_id, title, summary, content, published_at, is_published, created_by
) VALUES
  (1, 1, 'April 2026 Update', 'Dark mode planning and bug fixes.', 'Introduced roadmap improvements and fixed multiple UI bugs.', NOW(), 1, 2),
  (2, 1, 'Upcoming Improvements', 'Preview of next sprint.', 'Working on CSV export and comment threading enhancements.', NULL, 0, 1),
  (3, 2, 'Beta Launch Notes', 'Initial launch items.', 'Published first roadmap visibility controls.', NOW(), 1, 4);

INSERT IGNORE INTO notifications (
  id, tenant_id, user_id, notification_type, title, message, reference_type, reference_id, is_read, read_at
) VALUES
  (1, 1, 1, 'post_status', 'Post moved to planned', 'Add dark mode is now planned.', 'post', 1, 1, NOW()),
  (2, 1, 3, 'comment_reply', 'New reply on your post', 'Admin replied to your dark mode request.', 'comment', 2, 0, NULL),
  (3, 1, 2, 'changelog', 'New changelog published', 'April 2026 Update is live.', 'changelog', 1, 0, NULL),
  (4, 2, 4, 'system', 'Welcome to FeedBoard', 'Your tenant is ready to use.', NULL, NULL, 1, NOW());

INSERT IGNORE INTO api_keys (
  id, tenant_id, created_by, key_name, key_prefix, key_hash, scopes, last_used_at, expires_at, is_revoked
) VALUES
  (1, 1, 1, 'Server Integration Key', 'fb_live', 'dummy_hash_001', JSON_ARRAY('read:posts', 'write:posts', 'read:analytics'), NOW(), DATE_ADD(NOW(), INTERVAL 180 DAY), 0),
  (2, 1, 2, 'Readonly Widget Key', 'fb_ro', 'dummy_hash_002', JSON_ARRAY('read:posts'), NOW(), DATE_ADD(NOW(), INTERVAL 365 DAY), 0),
  (3, 2, 4, 'Beta Automation Key', 'fb_beta', 'dummy_hash_003', JSON_ARRAY('read:posts', 'read:roadmap'), NULL, NULL, 1);

INSERT IGNORE INTO audit_logs (
  id, tenant_id, actor_user_id, action, entity_type, entity_id, metadata, ip_address, user_agent
) VALUES
  (1, 1, 1, 'POST_CREATED', 'post', 1, JSON_OBJECT('title', 'Add dark mode'), '127.0.0.1', 'Seed Script/1.0'),
  (2, 1, 2, 'POST_STATUS_UPDATED', 'post', 1, JSON_OBJECT('oldStatus', 'open', 'newStatus', 'planned'), '127.0.0.1', 'Seed Script/1.0'),
  (3, 1, 3, 'COMMENT_CREATED', 'comment', 1, JSON_OBJECT('postId', 1), '127.0.0.1', 'Seed Script/1.0'),
  (4, 2, 4, 'TENANT_UPDATED', 'tenant', 2, JSON_OBJECT('plan', 'free'), '127.0.0.1', 'Seed Script/1.0');

INSERT IGNORE INTO integrations (
  id, tenant_id, integration_type, config, is_active
) VALUES
  (1, 1, 'slack', JSON_OBJECT('webhookUrl', 'https://hooks.slack.com/services/T000/B000/XXX', 'channel', '#product-feedback'), 1),
  (2, 1, 'webhook', JSON_OBJECT('url', 'https://example.com/webhooks/feedboard', 'secret', 'whsec_demo'), 1),
  (3, 2, 'discord', JSON_OBJECT('webhookUrl', 'https://discord.com/api/webhooks/demo'), 0);

INSERT IGNORE INTO file_uploads (
  id, tenant_id, uploaded_by, related_entity_type, related_entity_id, original_name, storage_path, mime_type, size_bytes
) VALUES
  (1, 1, 2, 'post', 1, 'dark-mode-mockup.png', 'uploads/dark-mode-mockup.png', 'image/png', 284512),
  (2, 1, 3, 'comment', 3, 'mobile-overlap.jpg', 'uploads/mobile-overlap.jpg', 'image/jpeg', 194321),
  (3, 2, 4, 'post', 5, 'roadmap-visibility.pdf', 'uploads/roadmap-visibility.pdf', 'application/pdf', 612003);

SET FOREIGN_KEY_CHECKS = 1;
