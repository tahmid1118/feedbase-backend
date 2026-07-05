require("dotenv").config();

const express = require("express");
const path = require("path");
const app = express();
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
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
const { stripeWebhookRouter } = require("./src/routes/webhooks/stripeWebhookRoute");
// --- Middleware ---
// gzip/deflate all compressible responses (JSON, text). Binary uploads under
// /uploads are skipped automatically by compression's content-type filter.
app.use(compression());
app.use(cors());
app.use(morgan("combined"));

// Stripe webhooks need the RAW body for signature verification, so this route
// is mounted BEFORE express.json and parses the body as a Buffer instead.
app.use(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookRouter
);

// Single JSON body parser (express.json IS body-parser.json — no need for both).
app.use(express.json({ limit: "10mb" }));
app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
    parameterLimit: 10000,
  })
);

// Bodyless requests (GET/DELETE without a payload) leave req.body undefined,
// which crashes handlers that read req.body.lg. Guarantee an object instead.
app.use((req, _res, next) => {
  if (req.body == null) req.body = {};
  next();
});

// --- Routes ---
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

// Graceful shutdown for nodemon restarts
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
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
