import { id, query } from './db.js';
import { campaignQueueMetrics } from './campaign-operations.js';
import { getPlatformOperationsSnapshot } from './platform-operations.js';
import { getPlatformSettingValue } from './platform.js';

function check(id, label, pass, detail = '') {
  return { id, label, pass: Boolean(pass), detail: String(detail || '').slice(0, 500) };
}

export async function computePlatformSloCertification(run = query) {
  const checks = [];
  const platform = await getPlatformOperationsSnapshot();
  const queue = await campaignQueueMetrics(run);

  checks.push(check('worker', 'Queue worker heartbeat', platform.worker.status === 'ready', platform.worker.status));
  checks.push(check('campaign_queue_lag', 'Campaign queue within SLO', queue.lagOk, `max=${queue.maxLagSeconds}s`));
  checks.push(
    check(
      'meta_webhooks',
      'Meta webhook queue healthy',
      platform.metaWebhooks.lagOk,
      `queued=${platform.metaWebhooks.queued} failed=${platform.metaWebhooks.failed}`
    )
  );

  const sendRow = (
    await run(
      `SELECT
        COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '24 hours')::int AS events_24h,
        COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '24 hours' AND http_status=429)::int AS rate_429_24h,
        COUNT(*) FILTER (WHERE created_at>NOW()-INTERVAL '24 hours' AND NOT retryable AND event_kind='failure')::int AS terminal_24h
       FROM campaign_send_events`
    )
  ).rows[0];
  const max429 = Number(await getPlatformSettingValue('slo_max_rate_limit_events_24h', 500));
  const maxTerminal = Number(await getPlatformSettingValue('slo_max_terminal_send_failures_24h', 200));
  const rate429 = Number(sendRow?.rate_429_24h || 0);
  const terminal = Number(sendRow?.terminal_24h || 0);
  checks.push(
    check(
      'send_rate_limits',
      '429 rate-limit events within threshold (24h)',
      rate429 <= max429,
      `${rate429} / ${max429}`
    )
  );
  checks.push(
    check(
      'send_terminal_failures',
      'Non-retryable send failures within threshold (24h)',
      terminal <= maxTerminal,
      `${terminal} / ${maxTerminal}`
    )
  );

  const loadTestRecorded = (
    await run("SELECT value FROM platform_settings WHERE key='load_test_last_passed_at'")
  ).rows[0]?.value;
  const loadTestRequired = await getPlatformSettingValue('slo_require_load_test_record', false);
  const loadTestPass = !loadTestRequired || Boolean(loadTestRecorded);
  checks.push(
    check(
      'load_test_record',
      'Volume load test recorded on this deployment',
      loadTestPass,
      loadTestRequired ? loadTestRecorded || 'Run scripts/load-test-slo.mjs on your VPS and set load_test_last_passed_at' : 'optional'
    )
  );

  const certified = checks.every((item) => item.pass);
  return {
    certified,
    checks,
    metrics: {
      campaignQueue: queue,
      sendEvents24h: Number(sendRow?.events_24h || 0),
      rateLimited24h: rate429,
      terminalFailures24h: terminal
    },
    generatedAt: new Date().toISOString()
  };
}

export async function recordPlatformSloCertificationRun({ createdBy } = {}, run = query) {
  const report = await computePlatformSloCertification(run);
  const runId = id('slor');
  await run(
    `INSERT INTO platform_slo_certification_runs(id,certified,summary,created_by) VALUES($1,$2,$3::jsonb,$4)`,
    [runId, report.certified, JSON.stringify(report), createdBy || null]
  );
  return { runId, ...report };
}

export async function latestPlatformSloCertification(run = query) {
  const row = (
    await run(
      `SELECT id,certified,summary,created_at FROM platform_slo_certification_runs ORDER BY created_at DESC LIMIT 1`
    )
  ).rows[0];
  if (!row) return { certified: false, checks: [], generatedAt: null, lastRunAt: null };
  const summary = row.summary || {};
  return {
    certified: row.certified,
    checks: summary.checks || [],
    metrics: summary.metrics || {},
    generatedAt: summary.generatedAt || null,
    lastRunAt: row.created_at,
    runId: row.id
  };
}
