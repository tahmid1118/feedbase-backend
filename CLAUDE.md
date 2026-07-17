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

Every authenticated request has `req.auth = { id, email, tenantId, role }` (set by `authenticateToken` from the JWT plus a DB re-check that the user is still active). Tenant-scoped data queries filter by `tenant_id`. **Tenant roles are only `owner` and `user`** (the `users.role` enum). `owner` administers the workspace (team/role changes, billing, feedback deletion); `user` is a plain member. The platform operator (**`admin`**) is NOT a tenant role — it's a separate `admins` table with its own auth (see below).

**Multiple workspaces per account:** an email can have a `users` row in several tenants — each is one of that account's "workspaces". `src/main/users/workspaces.js` (routes `GET /users/workspaces`, `GET /users/workspaces/check-subdomain`, `POST /users/workspaces/create`, `POST /users/workspaces/switch`) lists them, validates subdomain availability live, creates a new tenant + owner (seeding default `planned`/`in_progress`/`completed` roadmap columns), and re-issues a JWT scoped to a chosen workspace. Login by email (unscoped) returns the first matching row, so it picks a default workspace.

**`subdomain` vs `website`:** `subdomain` is unique and required (the portal host); the **owner** can change it later from Branding settings (`updateTenant` validates format + reserved words → `400 invalid_subdomain`, and uniqueness → `409 subdomain_taken`, keeping `slug` in sync). `PUT /tenants/update/:id` is **owner-only and self-scoped** (`:id` must equal `req.auth.tenantId`, else `403`). The onboarding "Website" is the company's site — stored in the non-unique, informational `website` column. (Custom domains are **not** a feature; the `tenants.custom_domain` column is unused/legacy and never written.)

**Pending accounts / onboarding:** `users.tenant_id` is **nullable**. Registration (`registerNewUser`) creates a *pending* account with `tenant_id = NULL` and a global email-uniqueness check — it does **not** default into tenant 1. A pending account has zero workspaces (so it can't see another tenant's data); its first `createWorkspace` **claims that row** (sets `tenant_id` + `role='owner'`) rather than inserting a new one. Subsequent workspaces insert a fresh owner row.

User self-service handlers (personal data, profile/password update) key off the authenticated `req.auth.id` **only** — never a client-supplied `userId` — to prevent cross-account writes.

### Authentication

- JWT Bearer tokens (`Authorization: Bearer <token>`), 90-day expiry by default
- `authenticateToken` middleware verifies token then queries DB to confirm user is still active
- Passwords hashed with bcrypt
- Unauthenticated routes: `POST /users/login`, `POST /users/register`, `POST /tenants/create`, `POST /admin/auth/login`, and the entire `/public/*` portal API (below)
- **Platform admin auth.** Admins are a **separate `admins` table** (independent of `users`, so the same email can be both). `adminLogin` (`src/main/admin/adminLogin.js`) issues a JWT with **`scope:'admin'`** + `adminId`; **`authenticateAdmin`** (`src/middlewares/jwt/authenticateAdmin.js`) verifies that scope against an active admin and sets `req.admin`. All `/admin/*` routes except login sit behind it. Bootstrap the first admin with `node scripts/create-admin.js <email> <password> [name]`; further admins are created in-panel.
- **Device sessions / one device at a time** (`src/common/sessions.js`, table `user_sessions`). Every user JWT carries an **`sid`** claim naming a session row; `authenticateToken` rejects a token whose session was revoked with **`401 "Session ended"`** (so a session dies immediately, without waiting for JWT expiry) and `touchSession`s it otherwise (throttled to one write/min). `optionalAuth` likewise falls back to *guest* for a revoked session.
  - Sessions are keyed by **email**, not `users.id` — one account may hold rows in several tenants, and switching workspaces must not look like a new device. Every place that mints a token therefore threads the `sid` through: `userLogin` / `oauthLogin` **start** one (via `startSession`), while `workspaces.js` (create/switch) and `invitations.js` (accept-as-existing) **carry the caller's through**.
  - `startSession` is the gate: on a plan without the **`multiDevice`** limit (Free, Pro) it refuses a second login with **`409 already_logged_in_elsewhere`** while another session is live. Business allows unlimited devices. The plan is that of the workspace being signed in to; an account with no workspace yet counts as Free.
  - **Force / takeover** — `startSession(user, req, { force })` and `userLogin` reading `userData.force`. A 409 means the password was correct, so the owner may confirm a takeover: `force` revokes **all** existing sessions for the email and logs in fresh (never blocks). This is the escape hatch so a stale session (browser closed without signing out) can't lock the owner out for the whole idle window; "one device at a time" still holds (the newest login wins, the rest die).
  - **A session idle >15 min (`IDLE_MINUTES`) is "abandoned"** and the next login takes it over, *revoking* it. Without this, closing the browser without signing out would lock the account out permanently. The takeover keeps the invariant: **at most one live session** on single-device plans.
  - **`POST /users/logout`** revokes the caller's session. The frontend must call it on sign-out (`lib/auth/end-session.ts`) — otherwise the user can't sign back in until the session goes idle. Deleting an account drops all its `user_sessions` rows.
  - A second **tab** shares the cookie, so there is no login for the backend to refuse — that's blocked client-side (`SingleTabGuard`).
- **Admin Panel API** (`src/routes/admin/adminRoute.js`, handlers in `src/main/admin/`): overview counts; workspaces (list/detail/update/**plan grant=comp**/delete) + **post moderation across any tenant** (`GET/PUT/DELETE /admin/workspaces/:id/posts…` → list / set-status (roadmap-synced) / pin / delete — `adminPosts.js`) + **comment moderation** (`GET /…/posts/:postId/comments`, `DELETE /…/comments/:commentId` — list / delete only, a top-level delete takes its replies; admins can't edit comment text — `adminComments.js`); users across all tenants (list/update/role/reset-password/delete); admins (list/create/activate/delete, self-guarded); promo codes (list/create/revoke); offers (list/create/deactivate).

### Public portal API

`src/routes/public/publicRoute.js` (mounted at `/public`) powers the frontend's unauthenticated per-tenant portal (`app/portal/[tenant]`). No JWT. The tenant is resolved by the `attachPublicTenant` middleware from the `:subdomain` URL param, matching `tenants.subdomain`. Handlers live in `src/main/public/`. Return only safe public fields — **no author emails**, and changelog/roadmap responses must filter to published/active rows only.

**Guest submissions:** `POST /public/:subdomain/feedback` lets anonymous visitors create posts. Guest posts have `author_id = NULL` and carry optional `submitter_name` / `submitter_email` (added to the `posts` table; `author_id` is now nullable). Any query that joins the author must `COALESCE(u.full_name, p.submitter_name, 'Anonymous') AS author_name` (and admins also get `COALESCE(u.email, p.submitter_email) AS author_email`). `submitter_email` is **never** exposed on public endpoints. Guest posts **and comments** also store an optional `guest_id` (the persistent `fb_guest_id` cookie, `posts.guest_id` / `comments.guest_id`); public create handlers persist it and public read handlers (`getPublicPostDetail`) return it, so the portal can render one guest a stable pseudonymous display identity. It's a non-PII opaque browser id, safe to expose; it's nulled when the author is a logged-in user.

**Logged-in actions on the portal:** the comment/feedback create routes use an `optionalAuth` middleware (`src/middlewares/jwt/optionalAuth.js`) — a valid Bearer token attaches `req.auth`, so the post/comment is attributed to that user (`author_id` set, no guest name); otherwise it's a guest. Public detail queries return `author_id` + `author_avatar` so the client can render the avatar and decide ownership. **Edit/delete** are owner-only and require login (`authenticateToken`): `PUT|DELETE /public/:subdomain/posts/:postId` and `PUT|DELETE /public/:subdomain/comments/:commentId` (`src/main/public/publicOwnerActions.js`, reject with `not_your_content` unless `author_id === req.auth.id`).

**Guest voting:** `POST /public/:subdomain/posts/:postId/vote { guestId }` toggles an anonymous upvote. The `votes` table now allows guest rows (`user_id` nullable, added `guest_id`, unique `(tenant_id, post_id, guest_id)`), so guest votes land in the same table and the existing `COUNT(*)` vote counts include them unchanged. Spam is limited to one vote per browser per post via the unique `guest_id` (a persistent client cookie).

**Voting is public-board-only — this is the *only* way to cast a vote.** Votes are a signal from a workspace's users, so a workspace's own owner/team must not vote on their feedback. `/votes` (`src/routes/vote/voteRoute.js`) is therefore **read-only**: it exposes `POST /votes/post/:postId` (`getPostVotes`) and nothing else — the authenticated `POST /votes/add` + `DELETE /votes/remove/:postId` routes and their `addVote`/`removeVote` handlers were **deleted**, since `authenticateToken` meant their only possible callers were the tenant users now barred from voting. The dashboard just displays `vote_count`. Don't re-add an authenticated vote write endpoint.

### Billing & subscriptions (Stripe)

- Tiers — **Free / Pro / Business**, each billable **monthly or yearly**, defined in **`src/consts/plans.js`** (`PLANS`, `planByPriceId`, `getPlanLimits`). Each paid plan has a monthly `priceId` (`STRIPE_PRICE_PRO`/`_BUSINESS`) **and** a `priceIdYearly` (`STRIPE_PRICE_PRO_YEARLY`/`_BUSINESS_YEARLY`); Free has none. `scripts/stripe-setup.js` creates both Prices per plan and prints the IDs. **Yearly is a genuinely cheaper price, not a coupon**: the per-month equivalent is rounded to a whole dollar (`round(monthly × (1 - YEARLY_DISCOUNT))`, `YEARLY_DISCOUNT = 0.2`) then × 12, so both stay integers → Pro $15/mo ($180/yr), Business $39/mo ($468/yr). Helpers: `priceIdFor(plan, interval)`, `planByPriceId` (matches monthly **or** yearly → plan key), `intervalByPriceId`.
- **Hosted Checkout + Customer Portal.** Authenticated routes at `/billing` (`src/routes/billing/billingRoute.js`, **owner only**): `POST /billing/status`, `POST /billing/checkout {plan, interval?, promotionCode?}` (`interval` = `"month"` default | `"year"` → picks the right Stripe price; a `promotionCode` is applied as a `discounts` entry, else `allow_promotion_codes` lets the user type one — but an active plan **offer** auto-coupon is applied to **monthly only**, since the yearly price already bakes in its discount), `POST /billing/portal` (→ Customer Portal URL), `POST /billing/redeem {code}` (promo redemption). Handlers in `src/main/billing/`. The shared client is `src/common/stripe.js` (constructed with a placeholder key when unset so the server still boots; real calls gated by `isStripeConfigured()`).
- **Webhook needs the raw body.** `/webhooks/stripe` is mounted in `app.js` with `express.raw({ type: "application/json" })` **before** the global `express.json` so signature verification works. `handleStripeWebhook` updates the tenant on `checkout.session.completed` / `customer.subscription.updated|deleted`. The shared write logic lives in `src/main/billing/applySubscription.js` (`applySubscription` / `resetToFree`) — resolving the tenant by `metadata.tenantId` or `stripe_customer_id`, and writing `plan_name` (via `planByPriceId`), `subscription_status`, `stripe_subscription_id`, `current_period_end`.
- **Reconcile-on-load (no-webhook fallback).** `getBillingStatus` calls `reconcileTenantSubscription(tenantId)` first — it pulls the tenant's latest subscription straight from Stripe and persists it. This keeps the plan correct after Checkout/cancellation **even when webhooks aren't delivered** (e.g. local dev without the Stripe CLI, where Stripe can't reach `localhost`). A Stripe error there is non-fatal (falls back to stored values). The webhook is still the real-time path in production. **Reconcile mostly skips tenants with `subscription_status='comped'`** so an admin/promo grant (which has no Stripe subscription) is never reset to free — **except** it reverts a **timed comp whose `current_period_end` has passed** back to Free (lifetime comps, `current_period_end` NULL, are preserved forever).
- **Comps & promo codes.** A **comp** is a paid `plan_name` with `subscription_status='comped'` and no Stripe subscription — set by an admin plan grant (`src/main/admin/workspaces.js`) or a free-plan promo redemption. **Admin grant duration**: `setWorkspacePlan(id, plan, durationMonths, lg)` (`PUT /admin/workspaces/:id/plan {plan, durationMonths}`) takes an optional `durationMonths` — falsy/0 = **lifetime** (`current_period_end` NULL), a positive integer = expires after that many months (`current_period_end = NOW()+N months`, reverted to Free by reconcile once past). It also **cancels any live Stripe subscription first** (`cancelStripeSubscription`, best-effort) so an override doesn't leave the tenant paying for — and "Manage billing" opening on — the old plan. Promo codes live in `promo_codes` / `promo_redemptions`: **percent-off** codes create a Stripe **coupon + promotion code** (`src/main/admin/promo.js`) applied at Checkout; **free-plan** codes are app records that comp the plan on redemption (`src/main/billing/redeemPromo.js`, owner-only, one per tenant, honoring expiry/limit). `planGuard.getPlanLimits` gates comped tenants correctly since they carry a paid `plan_name`.
- **Offers** (`offers` table, `src/main/admin/offers.js`, `src/common/offers.js`): an admin-set promotional **price** on a paid plan (`plans.js` now carries a numeric `price` as the list baseline). One active offer per plan, backed by a Stripe **percent-off coupon** (`duration:'forever'`) auto-applied at checkout when no promo code is passed (`createCheckoutSession` discount precedence: promo code → offer coupon → `allow_promotion_codes`). `getBillingStatus` returns `offers` (active offers keyed by plan with `originalPrice`/`offerPrice`/`percentOff`) for the Billing tab's diagonal-strike price, and the unauthenticated **`GET /public/offers`** returns the same (coupon id stripped) for the public pricing page. An offer is active only within its `[starts_at, ends_at]` window; date-only bounds are stored as LOCAL day boundaries (`… 00:00:00` / `… 23:59:59` strings) so timezone conversion doesn't shift activation. Deactivating an offer deletes its coupon.
- **Tenant billing columns** (on `tenants`): `plan_name` (existing), `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `billing_interval` (`'month'|'year'`, set from the subscription's price by `applySubscription`; NULL on free — surfaced by `getBillingStatus` as `billingInterval` so the UI can show "Billed yearly"), `current_period_end`. **`plan_name` is set only by Stripe** — `updateTenant` no longer accepts it (bypass closed).
- **Enforcement** via `src/common/planGuard.js` (`planAllows(tenantId, capability)`): `createIntegration` rejects with `402 PAYMENT_REQUIRED` + a `plan_limit_integrations` message on Free. **`deletePost`** requires the `owner` role (else `403 delete_feedback_owner_only`) **and** the `deleteFeedback` capability (Pro+, else `402 plan_limit_delete_feedback`) — the role check runs first. `seats` gates team invites. **`attachments`** (Pro+) gates feedback photo/video — see *Feedback attachments* below. **`contactSubmitter`** (Pro+) gates the submitter-contact feature: `getPostById` returns `author_email` as `null` on Free (so the email never reaches a Free client), and **`POST /posts/:id/notify-implemented`** (`notifyFeedbackImplemented`, owner-only) emails the submitter that their feedback is implemented — `402 plan_limit_contact_submitter` on Free, `400 feedback_not_completed` unless the post is `completed`, `400 no_submitter_email` if there's no address; on success it stamps `posts.implemented_notified_at`. **`multiDevice`** (Business only) governs one-device-at-a-time login — see *Device sessions* under Authentication.

### Feedback attachments

Photo/video on a feedback post, a **Pro+** capability (`limits.attachments`). Handlers in `src/main/attachments/attachments.js`; the guest-friendly `post_attachments` table (no uploader FK — public-board submitters have no account).

- **Two-step, upload-then-link.** A file is uploaded first (row with `post_id NULL`), then linked to the post it was submitted with. `storeAttachment(file, tenantId, lg)` validates kind + per-kind size and writes under `uploads/attachments/`; `attachToPost(db, ids, postId, tenantId)` claims only still-unlinked rows **in the same tenant** (an id can't be moved onto another workspace's post) and caps at `MAX_ATTACHMENTS_PER_POST` (3). `createPost` and `createPublicPost` accept `attachmentIds` and call it. Reads: `getAttachmentsForPost` on `getPostById` + `getPublicPostDetail`; board lists carry an `attachment_count` (+ a `thumbnail_path` on the public board).
- **Endpoints.** Authed dashboard: `POST /posts/attachment` (`authenticateToken` → `requireAttachmentsAuthed` → multer). Public board: `POST /public/:subdomain/attachments` (`attachPublicTenant` → `requireAttachmentsPublic` → multer). The plan gate (`src/middlewares/plan/requireAttachments.js`) runs **before multer** so a Free workspace never streams a rejected file (→ `402 plan_limit_attachments`). Field name is `file`; `src/common/file-upload/attachment-validator.js` allows images (png/jpg/webp/gif ≤10MB) + video (mp4/webm/mov ≤50MB, 50MB multer ceiling, 10MB image cap enforced in the handler).
- `resolvePublicTenant` exposes only `attachments_enabled` (a boolean from the plan), never the raw plan, so the portal knows whether to show the control. Attachments are served by the existing `/uploads` static mount; deleting a post cascades its `post_attachments` rows (FK `ON DELETE CASCADE`).
- Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_BUSINESS_YEARLY`. For local webhooks: `stripe listen --forward-to localhost:4560/webhooks/stripe`.

### Team invitations & email

- **Invite flow** (`src/main/invitations/invitations.js`, routes `src/routes/invitations/invitationRoute.js` at `/invitations` + two public routes on `/public`): the **owner** invites by email → a row in `invitations` with a `crypto.randomBytes(32)` **token**, a **7-day `expires_at`**, and `status='pending'`. The emailed link is `${FRONTEND_URL}/invite/<token>`.
- **Security.** The token is the credential. It is **single-use** — accept only matches `status='pending' AND expires_at > NOW()` (selected `FOR UPDATE` inside a transaction, so a double-click can't create two memberships) and then flips to `accepted`. Revoking sets `revoked`, killing the link instantly. Before sending, the address is checked for format **and a DNS MX lookup** (`isDeliverableEmail`) so typos like `gmial.com` are rejected; an inconclusive DNS result does not block.
- **Two accept paths.** *New user* → **public** `POST /public/invitations/:token/accept {fullName,password}` creates the account + membership (the link proves email ownership) and returns a JWT. *Existing account* → **authenticated** `POST /invitations/:token/accept`, which requires being signed in **as the invited email** (`invitation_wrong_account` otherwise) — otherwise anyone holding a forwarded link could join as that person.
- **Seats are now enforced** (the thing `plans.js` was waiting for): non-owner team members + outstanding invites must stay under `getPlanLimits(plan).seats`, else `402 plan_limit_seats`. `seats` counts members **besides the owner** (the owner, `role='owner'`, is excluded from the tally), so the effective totals are Free = owner + 2, Pro = owner + 5, Business = unlimited (∞ skips the check).
- **Per-account workspace caps** (`limits.ownWorkspaces` / `joinWorkspaces`) — how many workspaces one *account* (by email) may OWN and be a MEMBER of, distinct from the per-tenant `seats`. The account's **tier** is the highest plan among the workspaces it OWNS (`getAccountTier(email)` in `planGuard.js`; a fresh/member-only account is `free`), so the upgrade path is "upgrade a workspace you own to unlock more." Free owns 1 / joins 1, Pro 3 / 3, Business unlimited. `getAccountWorkspaceUsage(email)` returns `{ tier, ownedCount, memberCount, ownLimit, joinLimit, canCreate, canJoin }` (limits `null` = unlimited) and drives: `createWorkspace` → `402 plan_limit_workspaces_own` when `!canCreate` (a first workspace is always allowed since owned=0), and `acceptInvitationAsExistingUser` → `402 plan_limit_workspaces_join` when `!canJoin`. `getWorkspaces` returns the same `limits` so the UI can gate "Add Workspace". (A brand-new invite acceptee owns 0 / is member of 0, so the join gate only bites existing accounts.)
- **One owner per workspace.** Invitees always join as `role='user'`. `updateUserRole` refuses to create a second owner (`workspace_already_has_owner`) or to demote the last one (`workspace_needs_an_owner`).
- **New-feedback notification.** When a visitor posts on a tenant's public board, `createPublicPost` calls `notifyOwnerOfNewPost` (`src/main/public/`) to email the workspace **owner** (template: `src/common/emails/newFeedbackEmail.js`, deep-links to `/dashboard/feedback/:id`). It is **fire-and-forget — deliberately not awaited** so a slow SMTP round-trip can't delay the visitor's submission, and it swallows its own errors so a mail failure can never fail the post. It skips notifying the owner about their own submission.
- **In-app activity notifications.** `src/common/notifications.js` (`notifyTeam`) fans a row into `notifications` for **every active team member** (owner + users) of a tenant, keyed per-user. Called fire-and-forget (not awaited, swallows its own errors) from `createPublicPost` (`new_feedback`) and `createPublicComment` (`comment_reply`), each with `reference_type='post'` + the post id so the client deep-links to `/dashboard/feedback/:id`. The actor (`excludeUserId`) — a logged-in member who posted/commented — is not notified of their own activity. This is what fills the dashboard Notifications page + header bell (`getUnreadCount`); nothing else creates notifications yet.
- **Mailer** (`src/common/mailer.js`): provider precedence **Resend HTTP API** (`RESEND_API_KEY`) → **SMTP/nodemailer** (`SMTP_HOST/PORT/USER/PASS`) → **dev logger** (no provider configured ⇒ the message + link are printed to the console so the flow stays testable). `sendEmail` never throws — a mail failure must not roll back the invitation. The branded HTML template lives in `src/common/emails/invitationEmail.js`.

### Account deletion

`src/main/users/deleteAccount.js` (`POST /users/account/deletion-summary` + `POST /users/account/delete`, both authenticated). An account is an **email** with one `users` row per workspace, so deleting it means:

- **Re-authentication.** The current password is bcrypt-verified first — a hijacked session must not be able to destroy the account.
- **Owned workspaces are deleted outright** (one owner per workspace, no ownership transfer ⇒ they can't be orphaned). Any Stripe subscription is **cancelled first** so billing stops. `DELETE FROM tenants` then cascades everything (verified: the cascade succeeds even though some child FKs are `RESTRICT`, because those rows are cascade-deleted too).
- **Joined workspaces keep their data** — only the membership row goes. But several FKs into `users` are **`ON DELETE RESTRICT`**, so a plain delete would fail. Content that belongs to the *workspace*, not the leaver, is preserved instead of destroyed:
  - `posts.author_id` / `comments.author_id` (nullable) → **set NULL** (they stay on the board, shown as Anonymous).
  - `changelog_entries.created_by`, `api_keys.created_by`, `file_uploads.uploaded_by` (NOT NULL + RESTRICT) → **reassigned to that workspace's owner**.
  - `votes` / `notifications` / `oauth_accounts` cascade away; `audit_logs.actor_user_id` is `SET NULL`.
- All of it runs in one transaction, and pending `invitations` addressed to the email are cleaned up.

**If you add a new table referencing `users(id)`**, decide its delete rule deliberately — a `RESTRICT` + `NOT NULL` column must be handled in `deleteAccount` or account deletion will start failing.

### Conventions & gotchas

- **`paginationData` middleware REBUILDS `req.body.paginationData`** from a fixed set of fields (`itemsPerPage`, `currentPageNumber`, `sortOrder`, `filterBy`, `offset`, `sortBy`). Anything else you put in it is **silently dropped before the handler sees it** — if you add a new pagination field, whitelist it there too or you'll get a baffling "the handler works when called directly but not over HTTP" bug.
- **Board sort** (`newest` | `oldest` | `most_voted` | `least_voted`) is a `SORTS` map in both `getPostList.js` (dashboard) and `getPublicBoard.js` (portal); both order by `p.is_pinned DESC` first, then the chosen sort. `vote_count` is a SELECT alias, so the vote sorts work without a join.

- **Bodyless requests:** a global middleware in `app.js` defaults `req.body` to `{}`. Without it, GET/DELETE routes that read `req.body.lg` (or any body field) crash with `Cannot read properties of undefined`. Keep that middleware, and prefer `req.body?.x` in handlers.
- **Partial updates:** `UPDATE` handlers should set only the columns actually provided (build the `SET` clause dynamically). A blanket `SET col = ?` with an `undefined` value silently nulls existing data — e.g. moving a roadmap item must not wipe its `target_release_date`.

### File uploads

- `multer` handles multipart; `sharp` optimizes/resizes images
- Max size set via `FILE_UPLOAD_MAX_SIZE` env var (default 10MB)
- Files stored under `./uploads/` with unique names
- `checkIfFileSavePathExist` middleware creates the directory if missing
- **`POST /uploader/upload-image` is a GENERIC uploader** (`insertImageData`): it only stores the file and returns its path. It must **not** mutate the user's `avatar_url` — the same endpoint uploads the profile avatar *and* the Branding company logo, so writing the avatar there would leak the logo into the uploader's profile photo. The avatar is set only by the profile save (`updateUserData` with `avatarUrl`); the logo is saved as the tenant's `branding_logo_url`.

### Performance

- **Compression:** `compression()` gzips all compressible responses (JSON/text); binary `/uploads` are skipped by its content-type filter. It's the first middleware in `app.js`.
- **Body parsing:** a single `express.json({ limit: "10mb" })` (don't re-add `body-parser` — `express.json` is the same thing). The bodyless-`req.body` guard runs right after the parsers.
- **Connection pool** (`database/dbPool.js`): keep-alive enabled (prevents random `ECONNRESET`), idle recycling (`maxIdle`/`idleTimeout`), `connectTimeout`. Size via `DB_CONNECTION_LIMIT` / `DB_MAX_IDLE` env (default 15 / 10).
- **Static assets:** `/uploads` served with `Cache-Control: public, max-age=7d, immutable` (upload filenames are timestamped, so caching is safe).
- **Error handling:** a JSON 404 + central error handler are the last middlewares in `app.js` — unhandled errors return `{ status, message }`, never an HTML stack trace.
- **Indexes:** the schema is already well-indexed (composite `tenant_id`+column keys, FK indexes). Profile with `EXPLAIN` before adding more — every index slows writes.

### Database schema (22 tables)

Core: `tenants`, `users` (role `owner`/`user`), `invitations`, `posts`, `post_attachments` (photo/video, Pro+), `votes`, `comments`, `tags`, `post_tags`
Features: `roadmap_columns`, `roadmap_items`, `changelog_entries`, `notifications`
System: `api_keys`, `audit_logs`, `integrations`, `oauth_accounts`, `user_sessions` (device sessions — see Authentication)
Platform (not tenant-scoped): `admins`, `promo_codes`, `promo_redemptions`, `offers`

Post fields of note: `type` (feedback/feature/bug), `status` (`open`/`planned`/`in_progress`/`completed`/`closed`/`rejected`), `priority` (1–5). **`rejected`** = feedback the team declined: `updatePostStatus` validates the value; on the dashboard it appears in the "All" tab and its own "Rejected" tab (`getPostList` applies no special exclusion); the **public** board (`getPublicBoard`) and post detail (`getPublicPostDetail`) exclude it unconditionally so it's never shown to end users. It's restored by setting status back to `open`. (`closed` is a legacy value, not offered in the UI.)

## Environment

Copy `.env.example` to `.env`. Required variables include: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SECRET_ACCESS_TOKEN`, `ACCESS_TOKEN_EXPIRE`, `FILE_UPLOAD_MAX_SIZE`, `FRONTEND_URL` (Stripe return URLs **and the invite link base**), and OAuth credentials. Stripe billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_BUSINESS` (the server boots without them; billing endpoints just return "not configured"). Optional pool tuning: `DB_CONNECTION_LIMIT` (default 15), `DB_MAX_IDLE` (default 10).

**Email** (invitations) — all optional; with none set, invite emails are just logged to the console and the flow still works:
- `RESEND_API_KEY` — preferred (HTTP API). `MAIL_FROM` (e.g. `Feedbase <invites@yourdomain.com>`; a transactional provider requires a **verified sender/domain**) and `MAIL_REPLY_TO` (defaults to `tahmidshahriar.bd@gmail.com`).
- SMTP fallback: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (Gmail needs an **App Password**, not the account password).

Production/staging processes are managed by PM2 via `ecosystem.config.js`.
