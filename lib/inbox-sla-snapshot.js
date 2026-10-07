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
    responseMinutes: policy?.config?.slaMinutes ?? policy?.config?.responseMinutes ?? policy?.config?.response_minutes ?? null
  };
}

export async function inboxSlaDashboard(businessId, userId, role, run = query) {
  const sla = await inboxSlaSnapshot(businessId, run);
  const waitingRows = (
    await run(
      `SELECT w.conversation_id,w.waiting_since,w.breached_at,c.assigned_user_id,t.name AS contact_name
       FROM support_waiting w
       JOIN conversations c ON c.id=w.conversation_id AND c.business_id=w.business_id
       JOIN contacts t ON t.id=c.contact_id
       WHERE w.business_id=$1 AND w.waiting_since IS NOT NULL AND c.status='open'
       ORDER BY w.breached_at DESC NULLS LAST, w.waiting_since ASC
       LIMIT 12`,
      [businessId]
    )
  ).rows;
  const mine = (
    await run(
      `SELECT COUNT(*)::int AS open_assigned
       FROM conversations
       WHERE business_id=$1 AND status='open' AND assigned_user_id=$2`,
      [businessId, userId]
    )
  ).rows[0];
  const teamOpen = (
    await run(
      `SELECT COUNT(*)::int AS open_total FROM conversations WHERE business_id=$1 AND status='open'`,
      [businessId]
    )
  ).rows[0];
  return {
    ...sla,
    openConversations: Number(teamOpen?.open_total || 0),
    myOpenConversations: Number(mine?.open_assigned || 0),
    role,
    waiting: waitingRows.map((row) => ({
      conversationId: row.conversation_id,
      contactName: row.contact_name,
      waitingSince: row.waiting_since,
      breached: Boolean(row.breached_at),
      assignedUserId: row.assigned_user_id || '',
      assignedToMe: row.assigned_user_id === userId
    }))
  };
}
