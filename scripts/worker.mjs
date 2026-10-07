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
    signal: AbortSignal.timeout(Math.max(intervalMs, 60000))
  });
  const result = await response.json().catch(() => ({}));
  if (runRetention && result.retention !== undefined && !result.errors?.retention) nextRetentionAt = Date.now() + retentionIntervalMs;
  if (!response.ok) throw new Error(`Job endpoint returned ${response.status}: ${result.code || JSON.stringify(result.errors || {})}`);
  const activity = [result.metaWebhooks?.claimed, result.campaigns?.claimed, result.automation?.claimed, result.retention, result.metaHealth?.failed, result.integrations?.claimed, result.commerce?.started, result.commerce?.failed, result.support?.assigned, result.support?.breached, result.connectors?.processed, result.connectors?.skipped, result.checkoutRecovery?.queued, result.checkoutRecovery?.skipped,result.crmSync?.attempted,result.salesforceSync?.attempted,result.calendarFulfillment?.claimed,result.bookingNotices?.claimed,result.shopifyOrderCheck?.attempted,result.aiAutoReply?.attempted].some(Boolean);
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
    aiAutoReply: result.aiAutoReply
  });
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

while (!stopping) {
  try { await tick(); }
  catch (error) { console.error('Job cycle failed:', error.message); }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
