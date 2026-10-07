import { enterSystemContext, query } from "./db.js";

export function workerIsFresh(lastSuccessAt, now = Date.now(), pollIntervalMs = Number(process.env.JOB_POLL_INTERVAL_MS) || 15000) {
  const tolerance = Math.max(60000, pollIntervalMs * 4);
  const timestamp = lastSuccessAt ? new Date(lastSuccessAt).getTime() : NaN;
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= tolerance;
}

export const databaseRoleIsIsolated=role=>role?.rolsuper===false&&role?.rolbypassrls===false;

export async function readiness() {
  try {
    enterSystemContext();
    const [result, schema, webhookQueue, role, calendarQueue] = await Promise.all([
      query("SELECT last_success_at,last_cycle_errors FROM worker_heartbeats WHERE worker_name='queue'"),
      query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='feature_overrides') AS ready"),
      query("SELECT EXISTS(SELECT 1 FROM meta_webhook_queue WHERE status='failed') AS failed, (SELECT received_at FROM meta_webhook_queue WHERE status='queued' ORDER BY received_at LIMIT 1) AS oldest_queued_at"),
      query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user'),
      query("SELECT EXISTS(SELECT 1 FROM availability_fulfillments WHERE status IN ('needs_reconnect','failed')) AS needs_attention, (SELECT created_at FROM availability_fulfillments WHERE status IN ('pending','processing') ORDER BY created_at LIMIT 1) AS oldest_pending_at")
    ]);
    const workerReady = workerIsFresh(result.rows[0]?.last_success_at);
    const workerErrors=result.rows[0]?.last_cycle_errors||{};
    const queuesReady=Object.keys(workerErrors).length===0;
    const schemaReady = Boolean(schema.rows[0]?.ready);
    const oldest = webhookQueue.rows[0]?.oldest_queued_at;
    const configuredLag = Number(process.env.META_WEBHOOK_MAX_LAG_SECONDS);
    const maxLag = (Number.isFinite(configuredLag) && configuredLag >= 60 ? configuredLag : 300) * 1000;
    const webhookReady = webhookQueue.rows[0]?.failed !== true && (!oldest || Date.now() - new Date(oldest).getTime() <= maxLag);
    const isolationReady=databaseRoleIsIsolated(role.rows[0]);
    const oldestCalendar=calendarQueue.rows[0]?.oldest_pending_at;
    const calendarLag=Number(process.env.CALENDAR_FULFILLMENT_MAX_LAG_SECONDS);
    const maxCalendarLag=(Number.isFinite(calendarLag)&&calendarLag>=60?calendarLag:300)*1000;
    const calendarAttention=calendarQueue.rows[0]?.needs_attention===true||Boolean(oldestCalendar&&Date.now()-new Date(oldestCalendar).getTime()>maxCalendarLag);
    const { campaignQueueMetrics } = await import('./campaign-operations.js');
    const campaigns = await campaignQueueMetrics();
    const ready = workerReady && queuesReady && schemaReady && webhookReady && isolationReady && campaigns.lagOk;
    return Response.json({ status: ready ? "ready" : "degraded", database: "ready", databaseIsolation: isolationReady ? 'ready' : 'privileged_role', schema: schemaReady ? "ready" : "outdated", worker: workerReady ? (queuesReady?'ready':'degraded') : "stale", workerFailures:workerErrors, metaWebhooks: { status: webhookReady ? 'ready' : 'degraded', hasFailedEvents: webhookQueue.rows[0]?.failed === true }, calendarFulfillment:{status:calendarAttention?'attention':'ready'}, campaigns:{status:campaigns.lagOk?'ready':'degraded',...campaigns} }, {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return Response.json({ status: "unavailable", database: "unavailable", worker: "unknown" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
