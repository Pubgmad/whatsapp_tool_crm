import process from 'node:process';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());

const secret = process.env.JOB_RUNNER_SECRET;
const baseUrl = process.env.JOB_RUNNER_URL || process.env.APP_URL;
if (!secret || secret.startsWith('replace-with') || !baseUrl) {
  throw new Error('JOB_RUNNER_SECRET and JOB_RUNNER_URL or APP_URL are required.');
}

const intervalMs = Math.max(5000, Number(process.env.JOB_POLL_INTERVAL_MS) || 15000);
const retentionIntervalMs = 24 * 60 * 60 * 1000;
const endpoint = new URL('/api/jobs/run', baseUrl);
let nextRetentionAt = 0;
let stopping = false;

async function tick() {
  const runRetention = Date.now() >= nextRetentionAt;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ runRetention }),
    signal: AbortSignal.timeout(Math.max(intervalMs, 30000))
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Job endpoint returned ${response.status}: ${result.code || 'UNKNOWN'}`);
  if (runRetention) nextRetentionAt = Date.now() + retentionIntervalMs;
  const activity = [result.campaigns?.claimed, result.automation?.claimed, result.retention].some(Boolean);
  if (activity) console.info('Job cycle', {
    campaigns: result.campaigns,
    automation: result.automation,
    retention: result.retention
  });
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

while (!stopping) {
  try { await tick(); }
  catch (error) { console.error('Job cycle failed:', error.message); }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
