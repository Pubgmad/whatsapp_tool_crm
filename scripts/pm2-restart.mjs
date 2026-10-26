#!/usr/bin/env node
/**
 * Restart MathStrat CRM PM2 apps with the correct process names.
 * Use this instead of typing names by hand (typos like whatsapp-crm-workercd fail).
 *
 *   node scripts/pm2-restart.mjs
 *   npm run pm2:restart
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = 'whatsapp-crm';
const WORKER = 'whatsapp-crm-worker';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ecosystem = path.join(root, 'ecosystem.config.cjs');

function run(args) {
  const result = spawnSync('pm2', args, { stdio: 'inherit', shell: true, cwd: root });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  return result.status ?? 1;
}

function listNames() {
  const result = spawnSync('pm2', ['jlist'], { encoding: 'utf8', shell: true, cwd: root });
  if (result.status !== 0) {
    console.error('pm2 jlist failed. Is PM2 installed and is this the deploy user?');
    process.exit(1);
  }
  try {
    return new Set((JSON.parse(result.stdout || '[]') || []).map((app) => app.name));
  } catch {
    console.error('Could not parse pm2 jlist output.');
    process.exit(1);
  }
}

const names = listNames();
if (!names.has(WEB)) {
  console.error(`Process "${WEB}" not found. Start both apps with:\n  pm2 start ${ecosystem}`);
  process.exit(1);
}

const code = run(['restart', WEB, '--update-env']);
if (code !== 0) process.exit(code);

if (names.has(WORKER)) {
  const workerCode = run(['restart', WORKER, '--update-env']);
  if (workerCode !== 0) process.exit(workerCode);
} else {
  console.log(`Starting missing "${WORKER}" (required for webhooks, campaigns, automation)…`);
  const startCode = run(['start', ecosystem, '--only', WORKER]);
  if (startCode !== 0) process.exit(startCode);
}

process.exit(run(['save']) === 0 ? 0 : 1);
