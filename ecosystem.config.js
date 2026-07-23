module.exports = {
  apps: [
    {
      name: "feedboard-server",
      script: "app.js",

      /**
       * CLUSTER MODE.
       *
       * Node runs JavaScript on ONE thread, so a single `fork` instance uses one
       * CPU core no matter how big the box is — the other cores sit idle while
       * that one saturates under load. `cluster` starts one worker per core
       * behind PM2's built-in load balancer, multiplying throughput and, just as
       * importantly, removing the single point of failure: if one worker dies,
       * the others keep serving while PM2 replaces it.
       *
       * Set PM2_INSTANCES to pin a count (e.g. "2" on a small VPS where you want
       * headroom for MySQL); "max" uses every available core.
       *
       * NOTE: each worker has its own memory, so the in-process cache
       * (src/common/cache.js) and the rate-limit counters are PER WORKER. The
       * cache is fine (short TTLs, read-only data). The rate limits become
       * N x the configured max in aggregate — still a hard ceiling, but move to
       * a shared store (rate-limit-redis) if you need exact global limits.
       */
      instances: process.env.PM2_INSTANCES || "max",
      exec_mode: "cluster",

      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      // Restart a worker that leaks past 1GB rather than letting the OS OOM-kill
      // it abruptly mid-request.
      max_memory_restart: "1G",

      // Wait for the app's graceful shutdown (drain DB pool, flush logs) instead
      // of killing it mid-request. Must exceed SHUTDOWN_TIMEOUT_MS in app.js.
      kill_timeout: 20000,
      // Don't route traffic to a worker until it is actually listening, so a
      // reload never drops requests into a booting process.
      wait_ready: false,
      listen_timeout: 10000,

      env: {
        NODE_ENV: "development",
        APP_PORT: 4560,
      },
      env_staging: {
        NODE_ENV: "staging",
        APP_PORT: 4561,
      },
      env_production: {
        NODE_ENV: "production",
        APP_PORT: 4562,
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_file: "./logs/combined.log",
      time: true,
    },
  ],
};
