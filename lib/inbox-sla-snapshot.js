import { query } from './db.js';
import {
  listOpenSupportWaiting,
  openSupportQueueCounts,
  supportBreached7dCount
} from './support-queue-metrics.js';

export async function inboxSlaSnapshot(businessId, run = query) {
  const counts = await openSupportQueueCounts(businessId, run);
  const breached7d = await supportBreached7dCount(businessId, run);
  const policy = (await run('SELECT config,last_checked_at FROM support_policies WHERE business_id=$1', [businessId])).rows[0];
  return {
    waitingNow: counts.waitingNow,
    breachedNow: counts.breachedNow,
    breached7d,
    policyConfigured: Boolean(policy),
    lastCheckedAt: policy?.last_checked_at || null,
    responseMinutes: policy?.config?.slaMinutes ?? policy?.config?.responseMinutes ?? policy?.config?.response_minutes ?? null
  };
}

export async function inboxSlaDashboard(businessId, userId, role, run = query) {
  const sla = await inboxSlaSnapshot(businessId, run);
  const waitingRows = await listOpenSupportWaiting(businessId, 12, run);
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
