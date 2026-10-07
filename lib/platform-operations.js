import { enterSystemContext, query } from './db.js';
import { workerIsFresh } from './health.js';

export async function getPlatformOperationsSnapshot() {
  enterSystemContext();
  const [
    worker,
    schema,
    webhookQueue,
    role,
    calendarQueue,
    razorpayCycles,
    failedJobs
  ] = await Promise.all([
    query("SELECT last_success_at,last_cycle_errors FROM worker_heartbeats WHERE worker_name='queue'"),
    query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='feature_overrides') AS ready"),
    query("SELECT COUNT(*) FILTER (WHERE status='failed')::int AS failed, COUNT(*) FILTER (WHERE status='queued')::int AS queued, (SELECT received_at FROM meta_webhook_queue WHERE status='queued' ORDER BY received_at LIMIT 1) AS oldest_queued_at FROM meta_webhook_queue"),
    query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user'),
    query("SELECT COUNT(*) FILTER (WHERE status IN ('needs_reconnect','failed'))::int AS needs_attention, COUNT(*) FILTER (WHERE status IN ('pending','processing'))::int AS pending FROM availability_fulfillments"),
    query("SELECT value FROM platform_settings WHERE key='razorpay_subscription_total_count'"),
    query("SELECT COUNT(*)::int AS total FROM campaign_jobs WHERE status IN ('failed','retry')")
  ]);

  const workerReady = workerIsFresh(worker.rows[0]?.last_success_at);
  const workerErrors = worker.rows[0]?.last_cycle_errors || {};
  const cycles = Number(razorpayCycles.rows[0]?.value);
  const razorpayConfigured = Boolean(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET &&
    Number.isInteger(cycles) &&
    cycles >= 1 &&
    cycles <= 1000
  );

  const oldest = webhookQueue.rows[0]?.oldest_queued_at;
  const configuredLag = Number(process.env.META_WEBHOOK_MAX_LAG_SECONDS);
  const maxLag = (Number.isFinite(configuredLag) && configuredLag >= 60 ? configuredLag : 300) * 1000;
  const webhookLagOk = !oldest || Date.now() - new Date(oldest).getTime() <= maxLag;

  const isolationReady = role.rows[0]?.rolsuper === false && role.rows[0]?.rolbypassrls === false;

  return {
    billingProvider: 'razorpay',
    razorpayConfigured,
    razorpayBillingCycles: Number.isInteger(cycles) ? cycles : null,
    database: { schemaReady: Boolean(schema.rows[0]?.ready), isolationReady },
    worker: {
      status: workerReady ? (Object.keys(workerErrors).length ? 'degraded' : 'ready') : 'stale',
      lastSuccessAt: worker.rows[0]?.last_success_at || null,
      cycleErrors: workerErrors
    },
    metaWebhooks: {
      failed: Number(webhookQueue.rows[0]?.failed || 0),
      queued: Number(webhookQueue.rows[0]?.queued || 0),
      lagOk: webhookLagOk && Number(webhookQueue.rows[0]?.failed || 0) === 0
    },
    calendarFulfillment: {
      needsAttention: Number(calendarQueue.rows[0]?.needs_attention || 0),
      pending: Number(calendarQueue.rows[0]?.pending || 0)
    },
    campaignJobs: { backlog: Number(failedJobs.rows[0]?.total || 0) },
    generatedAt: new Date().toISOString()
  };
}
