require("dotenv").config();

const express = require("express");
const path = require("path");
const app = express();
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const helmet = require("helmet");
const { pool } = require("./database/dbPool");
const {
  apiLimiter,
  authLimiter,
  expensiveActionLimiter,
} = require("./src/middlewares/security/rateLimiters");
const {
  morganFormat,
  morganOptions,
  requestTimer,
  closeLogger,
} = require("./src/common/logger");
const { tenantRouter } = require("./src/routes/tenant/tenantRoute");
const { userRouter } = require("./src/routes/users/usersRoute");
const { postRouter } = require("./src/routes/post/postRoute");
const { voteRouter } = require("./src/routes/vote/voteRoute");
const { commentRouter } = require("./src/routes/comment/commentRoute");
const { tagRouter } = require("./src/routes/tag/tagRoute");
const { roadmapRouter } = require("./src/routes/roadmap/roadmapRoute");
const { changelogRouter } = require("./src/routes/changelog/changelogRoute");
const { notificationRouter } = require("./src/routes/notification/notificationRoute");
const { apiKeyRouter } = require("./src/routes/apikey/apiKeyRoute");
const { auditLogRouter } = require("./src/routes/auditlog/auditLogRoute");
const { integrationRouter } = require("./src/routes/integration/integrationRoute");
const { fileUploadRouter } = require("./src/routes/file-uploader/file-upload-route");
const { analyticsRouter } = require("./src/routes/analytics/analyticsRoute");
const { publicRouter } = require("./src/routes/public/publicRoute");
const { billingRouter } = require("./src/routes/billing/billingRoute");
const { adminRouter } = require("./src/routes/admin/adminRoute");
const { invitationRouter } = require("./src/routes/invitations/invitationRoute");
const { supportRouter } = require("./src/routes/support/supportRoute");
const { stripeWebhookRouter } = require("./src/routes/webhooks/stripeWebhookRoute");
// --- Middleware ---

// Behind a reverse proxy / load balancer (nginx, Cloudflare, a PaaS router) the
// socket address is the PROXY's, so every client would share one rate-limit
// bucket and X-Forwarded-For would be ignored. Trust exactly one hop — trusting
// all hops lets a client forge X-Forwarded-For and evade rate limiting entirely.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS) || 1);

// Security headers (HSTS, X-Content-Type-Options, frame denial, ...).
// crossOriginResourcePolicy is relaxed because /uploads serves avatars and
// attachments that the frontend loads from a different origin.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // API serves JSON + images, not HTML documents
  })
);

// gzip/deflate all compressible responses (JSON, text). Binary uploads under
// /uploads are skipped automatically by compression's content-type filter.
app.use(compression());

// CORS. The browser calls this API cross-origin from the app domain (dashboard
// client) and from every tenant portal subdomain (votes/comments/uploads). Auth
// is Bearer (Authorization header), not cookies, so there's no credentialed
// cross-site risk. In PRODUCTION with ROOT_DOMAIN set we restrict to the app
// origin + any subdomain of the root domain (+ CORS_EXTRA_ORIGINS); otherwise
// (dev, or unconfigured) we allow all so nothing breaks. Requests with no Origin
// (server-to-server, curl, <img>) are always allowed.
const buildCorsOptions = () => {
  const rootDomain = (process.env.ROOT_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const restrict = process.env.NODE_ENV === "production" && rootDomain;
  if (!restrict) return {}; // default cors(): reflect any origin

  const extra = (process.env.CORS_EXTRA_ORIGINS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const frontendUrl = (process.env.FRONTEND_URL || "").toLowerCase().replace(/\/$/, "");

  const isAllowed = (origin) => {
    let host;
    try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
    if (extra.includes(origin.toLowerCase())) return true;
    if (frontendUrl && origin.toLowerCase() === frontendUrl) return true;
    // The root domain itself and any subdomain of it (portals), port-agnostic.
    const bare = rootDomain.replace(/:\d+$/, "");
    const hostNoPort = host.replace(/:\d+$/, "");
    return hostNoPort === bare || hostNoPort.endsWith(`.${bare}`);
  };

  return {
    origin: (origin, cb) => {
      if (!origin || isAllowed(origin)) return cb(null, true);
      return cb(new Error(`CORS: origin not allowed: ${origin}`));
    },
  };
};
app.use(cors(buildCorsOptions()));

// Async access logging — see src/common/logger.js for why stdout is unsafe here.
// requestTimer must run first so the log filter can identify slow requests.
app.use(requestTimer);
app.use(morgan(morganFormat, morganOptions));

// Global rate limit, applied before body parsing so a flood is rejected before
// we spend CPU parsing its payloads.
app.use(apiLimiter);

/**
 * Per-request timeout. Without one, a slow client (or a slowloris attack) can
 * hold connections and pool slots open indefinitely until the server runs out
 * of both. Responds 503 and lets the socket go.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;
app.use((req, res, next) => {
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    if (res.headersSent) return res.end();
    res
      .status(503)
      .json({ status: "failed", message: "Request timed out. Please try again." });
  });
  next();
});

// Stripe webhooks need the RAW body for signature verification, so this route
// is mounted BEFORE express.json and parses the body as a Buffer instead.
app.use(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookRouter
);

// Single JSON body parser (express.json IS body-parser.json — no need for both).
//
// 1MB, not 10MB: every JSON endpoint here carries text (titles, markdown,
// settings), while real bulk — images and video — goes through multer on the
// upload routes and never touches this parser. A 10MB ceiling just meant a
// handful of concurrent requests could pin hundreds of MB of heap.
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "1mb";
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(
  express.urlencoded({
    extended: true,
    limit: JSON_BODY_LIMIT,
    // 10k params was enough for a hash-collision / CPU-burn payload.
    parameterLimit: 1000,
  })
);

// Bodyless requests (GET/DELETE without a payload) leave req.body undefined,
// which crashes handlers that read req.body.lg. Guarantee an object instead.
app.use((req, _res, next) => {
  if (req.body == null) req.body = {};
  next();
});

// --- Routes ---
//
// Targeted limiters mounted on the specific paths that need them. These run in
// addition to the global limiter above.
//
// Credential endpoints: each attempt costs a bcrypt comparison (~100ms of CPU),
// so an unthrottled login is both an account-security hole and a cheap way to
// saturate the CPU. Counts failures only (see authLimiter).
app.use("/users/login", authLimiter);
app.use("/users/register", authLimiter);
app.use("/admin/auth/login", authLimiter);
// Password reset: the "forgot" request sends email (expensive/abusable for
// spam); the "reset" submit is a credential action (brute-forceable token).
app.use("/users/password/forgot", expensiveActionLimiter);
app.use("/users/password/reset", authLimiter);
// Fan-out to email / Stripe — expensive per call and abusable for spam.
app.use("/invitations", expensiveActionLimiter);
app.use("/billing/checkout", expensiveActionLimiter);

app.use("/tenants", tenantRouter);
app.use("/users", userRouter);
app.use("/posts", postRouter);
app.use("/votes", voteRouter);
app.use("/comments", commentRouter);
app.use("/tags", tagRouter);
app.use("/roadmap", roadmapRouter);
app.use("/changelog", changelogRouter);
app.use("/notifications", notificationRouter);
app.use("/api-keys", apiKeyRouter);
app.use("/audit-logs", auditLogRouter);
app.use("/integrations", integrationRouter);
app.use("/uploader", fileUploadRouter);
app.use("/analytics", analyticsRouter);
app.use("/public", publicRouter);
app.use("/billing", billingRouter);
app.use("/admin", adminRouter);
app.use("/invitations", invitationRouter);
app.use("/support", supportRouter);


// --- Static Files ---
const staticFilePath = path.join(__dirname, "uploads");
app.use(
  "/uploads",
  express.static(staticFilePath, {
    maxAge: "7d", // uploaded assets are immutable enough to cache at the edge
    immutable: true,
  })
);

// --- 404 + central error handler (keep last) ---
app.use((req, res) => {
  res.status(404).json({ status: "failed", message: "Route not found" });
});

// Never leak stack traces; always respond with JSON.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res
    .status(err.status || 500)
    .json({ status: "failed", message: "Internal server error" });
});

// --- Server Start ---
const APP_PORT = process.env.APP_PORT;
const NODE_ENV = process.env.NODE_ENV || "development";

const server = app
  .listen(APP_PORT, () => {
    console.log(
      `🚀 Server running in ${NODE_ENV} mode at http://localhost:${APP_PORT}`
    );
  })
  .on("error", (err) => {
    console.error("Server failed to start:", err);
    process.exit(1);
  });

/**
 * Socket-level timeouts. These bound how long a client may hold a connection
 * BEFORE Express ever sees a complete request, which is precisely the window a
 * slowloris attack lives in (dribble headers forever, exhaust the connection
 * table). Node's defaults are generous; these are not.
 */
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS) || 30_000;
server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS) || 20_000;
server.keepAliveTimeout = Number(process.env.KEEPALIVE_TIMEOUT_MS) || 15_000;
// Cap total concurrent sockets so a flood degrades (connections refused at the
// edge) instead of driving the process into an out-of-memory kill.
server.maxConnections = Number(process.env.MAX_CONNECTIONS) || 2000;

/**
 * Graceful shutdown: stop accepting new connections, let in-flight requests
 * finish, then release the DB pool and flush logs. Without draining the pool,
 * a restart can leave MySQL holding sockets until they time out — which, across
 * repeated PM2 restarts, exhausts max_connections and takes the DB down for
 * every worker.
 */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: shutting down gracefully`);

  // Force-exit if a hung connection prevents a clean close.
  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 15_000);
  forceExit.unref();

  server.close(async () => {
    try {
      await pool.end();
      console.log("DB pool drained");
    } catch (err) {
      console.error("Error draining DB pool:", err.message);
    }
    try {
      await closeLogger();
    } catch {
      /* logging must never block shutdown */
    }
    console.log("HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/**
 * Last-resort crash guards.
 *
 * An unhandled promise rejection terminates the process by default in modern
 * Node — so a single forgotten `.catch()` on a background task (an email send,
 * a notification fan-out) could take down a server that was otherwise healthy.
 * Log and keep serving: the request that triggered it already failed, but the
 * other in-flight requests should not die with it.
 */
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection (continuing):", reason);
});

/**
 * An uncaught exception leaves the process in an undefined state, so unlike a
 * rejection we do NOT continue serving. Shut down cleanly and let PM2 restart
 * us — a fast, deliberate restart beats a process serving corrupt state.
 */
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception — restarting:", err);
  shutdown("uncaughtException");
});

// Development Scripts:
// npm run dev		- Run with nodemon in development mode (auto-reload)

// PM2 Production Scripts:
// npm run staging	- Run in staging environment with PM2
// npm start		- Run in production mode with PM2
// npm run restart	- Restart production app
// npm run restart:staging - Restart staging app
// npm run logs		- View PM2 logs in real time
// npm run stop		- Stop the PM2 app
// npm run delete		- Remove the app from PM2
