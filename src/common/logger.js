const fs = require("fs");
const path = require("path");

/**
 * Asynchronous request logging.
 *
 * THE PROBLEM: `morgan("combined")` writes to process.stdout. When stdout is a
 * FILE or a PIPE (which is exactly what PM2 gives you in production), Node's
 * stdout is SYNCHRONOUS — every log line blocks the event loop until the write
 * completes. At a few hundred requests/second that turns logging into the
 * bottleneck, and under a traffic spike or a flood it is actively harmful: the
 * server spends its time writing about requests instead of serving them.
 *
 * THE FIX: write through a buffered fs.WriteStream. Lines land in an in-memory
 * buffer and are flushed by libuv on the threadpool, so the request path never
 * blocks on disk I/O.
 *
 * Also drops successful, high-volume noise in production (2xx/3xx) — errors,
 * redirects to auth, and slow requests are what you actually need at 3am, and
 * logging every 200 OK is what fills a disk during an attack. A full disk is a
 * crash, so this is a resilience measure, not just tidiness.
 */

const isProd = process.env.NODE_ENV === "production";
const LOG_DIR = path.join(__dirname, "..", "..", "logs");

/** Lazily created so dev (console logging) never touches the filesystem. */
let accessStream = null;

function getAccessStream() {
  if (accessStream) return accessStream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    accessStream = fs.createWriteStream(path.join(LOG_DIR, "access.log"), {
      flags: "a", // append; PM2/logrotate own rotation
      highWaterMark: 64 * 1024, // buffer before hitting the disk
    });
    // A logging failure must never take the process down.
    accessStream.on("error", (err) => {
      console.error("access log stream error (logging disabled):", err.message);
      accessStream = null;
    });
  } catch (err) {
    console.error("could not open access log (falling back to stdout):", err.message);
    return process.stdout;
  }
  return accessStream;
}

/**
 * Morgan options. In development: coloured, synchronous console output (handy,
 * low volume). In production: async file stream + noise filtering.
 */
const morganFormat = isProd ? "combined" : "dev";

/** Threshold above which a successful request is still worth logging. */
const SLOW_REQUEST_MS = Number(process.env.SLOW_REQUEST_MS) || 1000;

/**
 * Stamps a monotonic start time so `skip` can identify slow requests. Mounted
 * before morgan in app.js. hrtime (not Date.now) so a clock adjustment can't
 * produce a negative duration.
 */
const requestTimer = (req, _res, next) => {
  req._startedAt = process.hrtime.bigint();
  next();
};

const morganOptions = isProd
  ? {
      stream: getAccessStream(),
      // Keep 4xx/5xx and anything slow; drop routine successes.
      skip: (req, res) => {
        if (res.statusCode >= 400) return false;
        if (req._startedAt) {
          const ms = Number(process.hrtime.bigint() - req._startedAt) / 1e6;
          if (ms > SLOW_REQUEST_MS) return false; // slow → keep for diagnosis
        }
        return true;
      },
    }
  : {};

/** Flush buffered log lines during graceful shutdown so nothing is lost. */
function closeLogger() {
  return new Promise((resolve) => {
    if (!accessStream || accessStream === process.stdout) return resolve();
    accessStream.end(resolve);
  });
}

module.exports = { morganFormat, morganOptions, requestTimer, closeLogger, isProd };
