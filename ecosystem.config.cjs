const cwd = __dirname;

module.exports = {
  apps: [
    {
      name: 'whatsapp-crm',
      cwd,
      script: 'npm',
      args: 'run start',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10
    },
    {
      name: 'whatsapp-crm-worker',
      cwd,
      script: 'npm',
      args: 'run worker',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10
    }
  ]
};
