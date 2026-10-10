import process from 'node:process';
import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { operationalPolicy } from '../lib/operational-policy.js';

nextEnv.loadEnvConfig(process.cwd());

const secret = process.env.JOB_RUNNER_SECRET;
const baseUrl = process.env.JOB_RUNNER_URL || process.env.APP_URL;
if (!secret || secret.startsWith('replace-with') || !baseUrl) {
  throw new Error('JOB_RUNNER_SECRET and JOB_RUNNER_URL or APP_URL are required.');
}

let runnerUrl;
try {
  runnerUrl = new URL(baseUrl);
} catch {
  throw new Error(`JOB_RUNNER_URL or APP_URL is invalid: ${baseUrl}`);
}
if (process.env.NODE_ENV === 'production' && runnerUrl.protocol !== 'https:') {
  throw new Error('Production worker requires HTTPS APP_URL / JOB_RUNNER_URL for Meta webhooks and Flow endpoints.');
}

const policy = operationalPolicy();
const intervalMs = policy.workerPollIntervalMs;
const retentionIntervalMs = policy.workerRetentionIntervalHours * 60 * 60 * 1000;
const endpoint = new URL('/api/jobs/run', baseUrl);
const healthPath = path.join(process.cwd(), '.runtime', 'worker-health.json');
let nextRetentionAt = 0;
let stopping = false;
let consecutiveFailures = 0;

async function writeHealth(payload) {
  try {
    await fs.mkdir(path.dirname(healthPath), { recursive: true });
    await fs.writeFile(healthPath, JSON.stringify({ ...payload, writtenAt: new Date().toISOString() }, null, 2));
  } catch (error) {
    console.warn('Could not write worker health file:', error.message);
  }
}

async function tick() {
  const runRetention = Date.now() >= nextRetentionAt;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ runRetention }),
    signal: AbortSignal.timeout(Math.max(intervalMs, 60000))
  });
  const result = await response.json().catch(() => ({}));
  if (runRetention && result.retention !== undefined && !result.errors?.retention) nextRetentionAt = Date.now() + retentionIntervalMs;
  if (!response.ok) throw new Error(`Job endpoint returned ${response.status}: ${result.code || JSON.stringify(result.errors || {})}`);
  consecutiveFailures = 0;
  await writeHealth({
    status: 'ok',
    endpoint: endpoint.toString(),
    automation: result.automation || null,
    campaigns: result.campaigns || null,
    metaWebhooks: result.metaWebhooks || null,
    errors: result.errors || null
  });
  const activity = [result.metaWebhooks?.claimed, result.campaigns?.claimed, result.automation?.claimed, result.retention, result.metaHealth?.failed, result.integrations?.claimed, result.commerce?.started, result.commerce?.failed, result.support?.assigned, result.support?.breached, result.connectors?.processed, result.connectors?.skipped, result.checkoutRecovery?.queued, result.checkoutRecovery?.skipped, result.paymentReconcile?.merchant, result.paymentReconcile?.native, result.crmSync?.attempted, result.salesforceSync?.attempted, result.calendarFulfillment?.claimed, result.bookingNotices?.claimed, result.shopifyOrderCheck?.attempted, result.aiAutoReply?.attempted, result.adsInsights?.synced, result.adsInsights?.failed].some(Boolean);
  if (activity) console.info('Job cycle', {
    metaWebhooks: result.metaWebhooks,
    campaigns: result.campaigns,
    automation: result.automation,
    retention: result.retention,
    metaHealth: result.metaHealth,
    integrations: result.integrations,
    commerce: result.commerce,
    support: result.support,
    connectors: result.connectors,
    checkoutRecovery: result.checkoutRecovery,
    crmSync: result.crmSync,
    salesforceSync: result.salesforceSync,
    calendarFulfillment: result.calendarFulfillment,
    bookingNotices: result.bookingNotices,
    shopifyOrderCheck: result.shopifyOrderCheck,
    aiAutoReply: result.aiAutoReply,
    adsInsights: result.adsInsights
  });
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

console.info(`Worker started → ${endpoint} (poll ${intervalMs}ms). Keep this process running for automation queues.`);

while (!stopping) {
  try {
    await tick();
  } catch (error) {
    consecutiveFailures += 1;
    console.error('Job cycle failed:', error.message);
    await writeHealth({ status: 'error', error: error.message, consecutiveFailures });
  }
  if (!stopping) {
    const backoff = Math.min(intervalMs * Math.max(1, 2 ** Math.min(consecutiveFailures, 4)), 120000);
    const waitMs = consecutiveFailures ? backoff : intervalMs;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

await writeHealth({ status: 'stopped' });
console.info('Worker stopped.');
