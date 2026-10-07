import { query } from './db.js';

/** Open conversations currently waiting on a human reply (canonical counts). */
export async function openSupportQueueCounts(businessId, run = query) {
  const row = (
    await run(
      `SELECT
        COUNT(*)::int AS waiting_now,
        COUNT(*) FILTER (WHERE w.breached_at IS NOT NULL)::int AS breached_now
       FROM support_waiting w
       JOIN conversations c ON c.id = w.conversation_id AND c.business_id = w.business_id
       WHERE w.business_id = $1
         AND w.waiting_since IS NOT NULL
         AND c.status = 'open'`,
      [businessId]
    )
  ).rows[0];
  const assigned = (
    await run(
      `SELECT COUNT(DISTINCT assigned_user_id)::int AS open_assigned
       FROM conversations
       WHERE business_id = $1 AND status = 'open' AND assigned_user_id IS NOT NULL`,
      [businessId]
    )
  ).rows[0];
  return {
    waitingNow: Number(row?.waiting_now || 0),
    breachedNow: Number(row?.breached_now || 0),
    openAssigned: Number(assigned?.open_assigned || 0)
  };
}

export async function supportBreached7dCount(businessId, run = query) {
  const row = (
    await run(
      `SELECT COUNT(*)::int AS breached_7d
       FROM support_waiting w
       JOIN conversations c ON c.id = w.conversation_id AND c.business_id = w.business_id
       WHERE w.business_id = $1
         AND w.breached_at IS NOT NULL
         AND w.breached_at > NOW() - INTERVAL '7 days'`,
      [businessId]
    )
  ).rows[0];
  return Number(row?.breached_7d || 0);
}

export async function listOpenSupportWaiting(businessId, limit = 12, run = query) {
  const capped = Math.min(Math.max(Number(limit) || 12, 1), 50);
  const rows = (
    await run(
      `SELECT w.conversation_id,w.waiting_since,w.breached_at,c.assigned_user_id,t.name AS contact_name
       FROM support_waiting w
       JOIN conversations c ON c.id=w.conversation_id AND c.business_id=w.business_id
       JOIN contacts t ON t.id=c.contact_id
       WHERE w.business_id=$1 AND w.waiting_since IS NOT NULL AND c.status='open'
       ORDER BY w.breached_at DESC NULLS LAST, w.waiting_since ASC
       LIMIT $2`,
      [businessId, capped]
    )
  ).rows;
  return rows;
}
