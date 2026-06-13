require("dotenv").config();

const express = require("express");
const path = require("path");
const app = express();
const cors = require("cors");
const morgan = require("morgan");
const bodyParser = require("body-parser");
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
// --- Middleware ---
app.use(bodyParser.json());
app.use(morgan("combined"));
app.use(cors());

app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
    parameterLimit: 10000,
  })
);
app.use(express.json({ limit: "10mb" }));

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


// --- Static Files ---
const staticFilePath = path.join(__dirname, "uploads");
app.use("/uploads", express.static(staticFilePath));

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
