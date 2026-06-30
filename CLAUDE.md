# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Keep this file current.** Whenever you change the request flow, response format, auth, multi-tenancy rules, the route surface (e.g. adding a router or public endpoint), env vars, or the DB schema, update the relevant section here *in the same change*. A drifted CLAUDE.md is a bug.

> **Keep the SRS current.** A feature change here (new endpoint, or schema that backs a user-facing feature) must also be reflected in the product SRS at `D:\Development\Frontend\feedbase\feedbase_srs.txt`, *in the same change*. Keep it clean and professional — a structured requirements spec, not a changelog.

> **Always push after a change.** After completing and verifying a change, commit it and `git push` to the GitHub remote — do not leave finished work uncommitted or unpushed. The frontend and backend are separate repos; when a task touches both, commit and push **both**. (This guards against the working tree being reverted between sessions.)

## Commands

```bash
npm run dev        # Start development server with hot reload (port 4560)
npm run staging    # Start PM2 staging process (port 4561)
npm start          # Start PM2 production process (port 4562)
npm run logs       # Tail PM2 logs
npm run restart    # Restart production PM2 process
```

No test runner is configured yet (`npm test` is a placeholder).

## Architecture

Multi-tenant SaaS REST API for feedback collection, roadmap planning, and changelog publishing. Built with Node.js/Express, MySQL (raw SQL via `mysql2/promise`), and JWT auth. No ORM.

### Layer structure

```
app.js              → Express setup, route mounting, static file serving
src/routes/         → Express routers (one file per domain)
src/main/           → Business logic handlers (called directly by routes)
src/middlewares/    → JWT auth, language validation, pagination, file upload
src/common/         → setServerResponse() response builder
src/consts/         → HTTP codes, response message keys
database/dbPool.js  → MySQL connection pool (10 connections, UTC timezone)
uploads/            → Stored user-uploaded files
```

### Request flow

`Route → authenticateToken → languageValidator → handler function → setServerResponse()`

Route handlers call business logic directly (no service layer). Handlers return promises; routes use `.then().catch()`.

### Response format

Handlers build responses with `setServerResponse(code, msgKey, lg, result?)`, which returns `{ statusCode, status: "success"|"failed", message, result }`. Routes then send `{ status, message, data: result }` to the client (note the `result` → `data` rename happens in the route).

Messages are looked up from **`src/common/response-message.json`** by key + language. The file has `en` and `bn` blocks — **add every new key to both**, or the lookup falls back to a "message not found" placeholder.

### Multi-tenancy

Every authenticated request has `req.auth = { id, email, tenantId, role }` (set by `authenticateToken` from the JWT plus a DB re-check that the user is still active). Tenant-scoped data queries filter by `tenant_id`. Roles: `owner`, `admin`, `moderator`, `user`.

**Multiple workspaces per account:** an email can have a `users` row in several tenants — each is one of that account's "workspaces". `src/main/users/workspaces.js` (routes `GET /users/workspaces`, `GET /users/workspaces/check-subdomain`, `POST /users/workspaces/create`, `POST /users/workspaces/switch`) lists them, validates subdomain availability live, creates a new tenant + owner (seeding default `planned`/`in_progress`/`completed` roadmap columns), and re-issues a JWT scoped to a chosen workspace. Login by email (unscoped) returns the first matching row, so it picks a default workspace.

**`subdomain` vs `custom_domain` vs `website`:** `subdomain` is unique and required (the portal host). `custom_domain` is the unique, deliberately-set custom portal domain (Branding settings, Pro+). The onboarding "Website" is the company's site — stored in the non-unique `website` column, **never** `custom_domain` (writing it there made unrelated workspaces collide and surfaced as a false "subdomain taken"). `createWorkspace` leaves `custom_domain` null.

**Pending accounts / onboarding:** `users.tenant_id` is **nullable**. Registration (`registerNewUser`) creates a *pending* account with `tenant_id = NULL` and a global email-uniqueness check — it does **not** default into tenant 1. A pending account has zero workspaces (so it can't see another tenant's data); its first `createWorkspace` **claims that row** (sets `tenant_id` + `role='owner'`) rather than inserting a new one. Subsequent workspaces insert a fresh owner row.

User self-service handlers (personal data, profile/password update) key off the authenticated `req.auth.id` **only** — never a client-supplied `userId` — to prevent cross-account writes.

### Authentication

- JWT Bearer tokens (`Authorization: Bearer <token>`), 90-day expiry by default
- `authenticateToken` middleware verifies token then queries DB to confirm user is still active
- Passwords hashed with bcrypt
- Unauthenticated routes: `POST /users/login`, `POST /users/register`, `POST /tenants/create`, and the entire `/public/*` portal API (below)

### Public portal API

`src/routes/public/publicRoute.js` (mounted at `/public`) powers the frontend's unauthenticated per-tenant portal (`app/portal/[tenant]`). No JWT. The tenant is resolved by the `attachPublicTenant` middleware from the `:subdomain` URL param, matching `tenants.subdomain` **OR** `tenants.custom_domain`. Handlers live in `src/main/public/`. Return only safe public fields — **no author emails**, and changelog/roadmap responses must filter to published/active rows only.

**Guest submissions:** `POST /public/:subdomain/feedback` lets anonymous visitors create posts. Guest posts have `author_id = NULL` and carry optional `submitter_name` / `submitter_email` (added to the `posts` table; `author_id` is now nullable). Any query that joins the author must `COALESCE(u.full_name, p.submitter_name, 'Anonymous') AS author_name` (and admins also get `COALESCE(u.email, p.submitter_email) AS author_email`). `submitter_email` is **never** exposed on public endpoints.

**Guest voting:** `POST /public/:subdomain/posts/:postId/vote { guestId }` toggles an anonymous upvote. The `votes` table now allows guest rows (`user_id` nullable, added `guest_id`, unique `(tenant_id, post_id, guest_id)`), so guest votes land in the same table and the existing `COUNT(*)` vote counts include them unchanged. Spam is limited to one vote per browser per post via the unique `guest_id` (a persistent client cookie).

### Billing & subscriptions (Stripe)

- Tiers — **Free / Pro / Business** (monthly), defined in **`src/consts/plans.js`** (`PLANS`, `planByPriceId`, `getPlanLimits`). Pro/Business Stripe Price IDs come from env (`STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`); Free has none. `scripts/stripe-setup.js` creates the Products/Prices and prints the IDs.
- **Hosted Checkout + Customer Portal.** Authenticated routes at `/billing` (`src/routes/billing/billingRoute.js`, owner/admin only): `POST /billing/status`, `POST /billing/checkout {plan}` (→ Stripe Checkout URL), `POST /billing/portal` (→ Customer Portal URL). Handlers in `src/main/billing/`. The shared client is `src/common/stripe.js` (constructed with a placeholder key when unset so the server still boots; real calls gated by `isStripeConfigured()`).
- **Webhook needs the raw body.** `/webhooks/stripe` is mounted in `app.js` with `express.raw({ type: "application/json" })` **before** the global `express.json` so signature verification works. `handleStripeWebhook` updates the tenant on `checkout.session.completed` / `customer.subscription.updated|deleted`. The shared write logic lives in `src/main/billing/applySubscription.js` (`applySubscription` / `resetToFree`) — resolving the tenant by `metadata.tenantId` or `stripe_customer_id`, and writing `plan_name` (via `planByPriceId`), `subscription_status`, `stripe_subscription_id`, `current_period_end`.
- **Reconcile-on-load (no-webhook fallback).** `getBillingStatus` calls `reconcileTenantSubscription(tenantId)` first — it pulls the tenant's latest subscription straight from Stripe and persists it. This keeps the plan correct after Checkout/cancellation **even when webhooks aren't delivered** (e.g. local dev without the Stripe CLI, where Stripe can't reach `localhost`). A Stripe error there is non-fatal (falls back to stored values). The webhook is still the real-time path in production.
- **Tenant billing columns** (on `tenants`): `plan_name` (existing), `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end`. **`plan_name` is set only by Stripe** — `updateTenant` no longer accepts it (bypass closed).
- **Enforcement** via `src/common/planGuard.js` (`planAllows(tenantId, capability)`): `createIntegration` and `updateTenant` (when setting `custom_domain`) reject with `402 PAYMENT_REQUIRED` + a `plan_limit_*` message on Free. (Custom domain is now persisted by `updateTenant`; it previously wasn't.) `seats` is a displayed limit only — there's no team-invite flow to gate yet.
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`. For local webhooks: `stripe listen --forward-to localhost:4560/webhooks/stripe`.

### Conventions & gotchas

- **Bodyless requests:** a global middleware in `app.js` defaults `req.body` to `{}`. Without it, GET/DELETE routes that read `req.body.lg` (or any body field) crash with `Cannot read properties of undefined`. Keep that middleware, and prefer `req.body?.x` in handlers.
- **Partial updates:** `UPDATE` handlers should set only the columns actually provided (build the `SET` clause dynamically). A blanket `SET col = ?` with an `undefined` value silently nulls existing data — e.g. moving a roadmap item must not wipe its `target_release_date`.

### File uploads

- `multer` handles multipart; `sharp` optimizes/resizes images
- Max size set via `FILE_UPLOAD_MAX_SIZE` env var (default 10MB)
- Files stored under `./uploads/` with unique names
- `checkIfFileSavePathExist` middleware creates the directory if missing

### Performance

- **Compression:** `compression()` gzips all compressible responses (JSON/text); binary `/uploads` are skipped by its content-type filter. It's the first middleware in `app.js`.
- **Body parsing:** a single `express.json({ limit: "10mb" })` (don't re-add `body-parser` — `express.json` is the same thing). The bodyless-`req.body` guard runs right after the parsers.
- **Connection pool** (`database/dbPool.js`): keep-alive enabled (prevents random `ECONNRESET`), idle recycling (`maxIdle`/`idleTimeout`), `connectTimeout`. Size via `DB_CONNECTION_LIMIT` / `DB_MAX_IDLE` env (default 15 / 10).
- **Static assets:** `/uploads` served with `Cache-Control: public, max-age=7d, immutable` (upload filenames are timestamped, so caching is safe).
- **Error handling:** a JSON 404 + central error handler are the last middlewares in `app.js` — unhandled errors return `{ status, message }`, never an HTML stack trace.
- **Indexes:** the schema is already well-indexed (composite `tenant_id`+column keys, FK indexes). Profile with `EXPLAIN` before adding more — every index slows writes.

### Database schema (15 tables)

Core: `tenants`, `users`, `posts`, `votes`, `comments`, `tags`, `post_tags`
Features: `roadmap_columns`, `roadmap_items`, `changelog_entries`, `notifications`
System: `api_keys`, `audit_logs`, `integrations`, `oauth_accounts`

Post fields of note: `type` (feedback/feature/bug), `status` (open/in-progress/closed), `priority` (1–5).

## Environment

Copy `.env.example` to `.env`. Required variables include: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SECRET_ACCESS_TOKEN`, `ACCESS_TOKEN_EXPIRE`, `FILE_UPLOAD_MAX_SIZE`, `FRONTEND_URL` (Stripe success/return URLs), SMTP config, and OAuth credentials. Stripe billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS` (the server boots without them; billing endpoints just return "not configured"). Optional pool tuning: `DB_CONNECTION_LIMIT` (default 15), `DB_MAX_IDLE` (default 10).

Production/staging processes are managed by PM2 via `ecosystem.config.js`.
