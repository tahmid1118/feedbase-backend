module.exports = {
  apps: [
    {
      name: "feedbase-server",
      script: "app.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      max_memory_restart: "1G",
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
