import { query } from './db.js';

export async function inboxSlaSnapshot(businessId, run = query) {
  const waiting = (
    await run(
      `SELECT
        COUNT(*) FILTER (WHERE waiting_since IS NOT NULL AND responded_at IS NULL)::int AS waiting_now,
        COUNT(*) FILTER (WHERE breached_at IS NOT NULL AND responded_at IS NULL)::int AS breached_now,
        COUNT(*) FILTER (WHERE breached_at IS NOT NULL AND breached_at>NOW()-INTERVAL '7 days')::int AS breached_7d
       FROM support_waiting WHERE business_id=$1`,
      [businessId]
    )
  ).rows[0];
  const policy = (await run('SELECT config,last_checked_at FROM support_policies WHERE business_id=$1', [businessId])).rows[0];
  return {
    waitingNow: Number(waiting?.waiting_now || 0),
    breachedNow: Number(waiting?.breached_now || 0),
    breached7d: Number(waiting?.breached_7d || 0),
    policyConfigured: Boolean(policy),
    lastCheckedAt: policy?.last_checked_at || null,
    responseMinutes: policy?.config?.responseMinutes ?? policy?.config?.response_minutes ?? null
  };
}
