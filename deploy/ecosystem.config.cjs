// PM2 processes for production (docs/deployment.md). Run by the `vertexhub` user from the
// `current` release; the environment comes from the release's .env (a link to shared/.env).
const root = '/srv/hub.vertexmedia.pro/current';
const logs = '/var/log/hub.vertexmedia.pro';

const common = {
  cwd: root,
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  max_restarts: 10,
  min_uptime: '20s',
  exp_backoff_restart_delay: 200,
  // Nest shutdown hooks close the HTTP server, pg-boss and the database pool.
  kill_timeout: 15000,
  max_memory_restart: '768M',
  time: true,
  merge_logs: true,
  // Set here as well as in .env: production behaviour never depends on one hand-edited file.
  env: { NODE_ENV: 'production' },
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'vertexhub-api',
      script: 'apps/api/dist/main.js',
      out_file: `${logs}/api.out.log`,
      error_file: `${logs}/api.err.log`,
    },
    {
      ...common,
      name: 'vertexhub-worker',
      script: 'apps/worker/dist/main.js',
      out_file: `${logs}/worker.out.log`,
      error_file: `${logs}/worker.err.log`,
    },
  ],
};
