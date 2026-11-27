/* global __dirname */
/**
 * Isolated staging PM2 profile — separate from production whatsapp-crm / whatsapp-crm-worker.
 * Deploy path: /var/www/whatsapp-crm-staging (never reuse /var/www/whatsapp-crm).
 * Requires staging .env.local with PORT=3001, distinct DATABASE_URL, JOB_RUNNER_SECRET, APP_URL.
 */
const cwd = __dirname;

module.exports = {
  apps: [
    {
      name: 'whatsapp-crm-staging',
      cwd,
      script: 'npm',
      args: 'run start',
      env: {
        NODE_ENV: 'production',
        PORT: '3001'
      },
      autorestart: true,
      max_restarts: 10,
      error_file: '/home/deploy/.pm2/logs/whatsapp-crm-staging-error.log',
      out_file: '/home/deploy/.pm2/logs/whatsapp-crm-staging-out.log'
    },
    {
      name: 'whatsapp-crm-staging-worker',
      cwd,
      script: 'npm',
      args: 'run worker',
      env: {
        NODE_ENV: 'production',
        JOB_RUNNER_URL: 'http://127.0.0.1:3001',
        // Loopback-only HTTP for isolated staging DB; mock Meta sends (no Graph traffic).
        ALLOW_LOCAL_JOB_RUNNER: '1',
        META_SEND_MODE: 'mock',
        ALLOW_META_SEND_MOCK: '1'
      },
      autorestart: true,
      max_restarts: 10,
      error_file: '/home/deploy/.pm2/logs/whatsapp-crm-staging-worker-error.log',
      out_file: '/home/deploy/.pm2/logs/whatsapp-crm-staging-worker-out.log'
    }
  ]
};