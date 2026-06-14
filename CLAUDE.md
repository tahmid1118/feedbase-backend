# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Keep this file current.** Whenever you change the request flow, response format, auth, multi-tenancy rules, the route surface (e.g. adding a router or public endpoint), env vars, or the DB schema, update the relevant section here *in the same change*. A drifted CLAUDE.md is a bug.

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

Copy `.env.example` to `.env`. Required variables include: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SECRET_ACCESS_TOKEN`, `ACCESS_TOKEN_EXPIRE`, `FILE_UPLOAD_MAX_SIZE`, SMTP config, and OAuth credentials. Optional pool tuning: `DB_CONNECTION_LIMIT` (default 15), `DB_MAX_IDLE` (default 10).

Production/staging processes are managed by PM2 via `ecosystem.config.js`.
