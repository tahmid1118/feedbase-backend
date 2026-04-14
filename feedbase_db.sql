SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS feedbase_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE feedbase_db;

CREATE TABLE IF NOT EXISTS tenants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  subdomain VARCHAR(120) NOT NULL,
  custom_domain VARCHAR(255) NULL,
  plan_name VARCHAR(50) NOT NULL DEFAULT 'free',
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

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NULL,
  full_name VARCHAR(150) NOT NULL,
  contact_no VARCHAR(20) NULL,
  role ENUM('visitor', 'user', 'moderator', 'admin', 'owner') NOT NULL DEFAULT 'user',
  avatar_url VARCHAR(500) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  KEY idx_users_tenant_role (tenant_id, role),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
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
  author_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  post_type ENUM('feedback', 'feature_request', 'bug_report') NOT NULL DEFAULT 'feedback',
  status ENUM('open', 'planned', 'in_progress', 'completed', 'closed') NOT NULL DEFAULT 'open',
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
  user_id BIGINT UNSIGNED NOT NULL,
  vote_type ENUM('upvote') NOT NULL DEFAULT 'upvote',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_votes_unique (tenant_id, post_id, user_id),
  KEY idx_votes_post (tenant_id, post_id),
  CONSTRAINT fk_votes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  post_id BIGINT UNSIGNED NOT NULL,
  author_id BIGINT UNSIGNED NOT NULL,
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
  notification_type ENUM('post_status', 'comment_reply', 'mention', 'changelog', 'system') NOT NULL,
  title VARCHAR(160) NOT NULL,
  message TEXT NULL,
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

-- -----------------------------------------------------
-- Dummy seed data
-- -----------------------------------------------------

INSERT IGNORE INTO tenants (
  id, name, slug, subdomain, custom_domain, plan_name, branding_logo_url, branding_primary_color, is_active
) VALUES
  (1, 'Acme Labs', 'acme-labs', 'acme', 'feedback.acme.test', 'pro', 'https://cdn.example.com/acme/logo.png', '#0A7CFF', 1),
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
  (4, 2, 4, 'system', 'Welcome to Feedbase', 'Your tenant is ready to use.', NULL, NULL, 1, NOW());

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
  (2, 1, 'webhook', JSON_OBJECT('url', 'https://example.com/webhooks/feedbase', 'secret', 'whsec_demo'), 1),
  (3, 2, 'discord', JSON_OBJECT('webhookUrl', 'https://discord.com/api/webhooks/demo'), 0);

INSERT IGNORE INTO file_uploads (
  id, tenant_id, uploaded_by, related_entity_type, related_entity_id, original_name, storage_path, mime_type, size_bytes
) VALUES
  (1, 1, 2, 'post', 1, 'dark-mode-mockup.png', 'uploads/dark-mode-mockup.png', 'image/png', 284512),
  (2, 1, 3, 'comment', 3, 'mobile-overlap.jpg', 'uploads/mobile-overlap.jpg', 'image/jpeg', 194321),
  (3, 2, 4, 'post', 5, 'roadmap-visibility.pdf', 'uploads/roadmap-visibility.pdf', 'application/pdf', 612003);

SET FOREIGN_KEY_CHECKS = 1;
