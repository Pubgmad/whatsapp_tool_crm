import { query } from './db.js';

/** Recent assignment and handoff audit entries for inbox operations dashboards. */
export async function conversationHandoffTimeline(businessId, limit = 40) {
  const capped = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const rows = (
    await query(
      `SELECT action, metadata, created_at, user_id
       FROM audit_logs
       WHERE business_id=$1 AND action IN ('conversation_assigned','conversation_takeover','support_auto_assigned','support_sla_breached')
       ORDER BY created_at DESC
       LIMIT $2`,
      [businessId, capped]
    )
  ).rows;
  return rows.map((row) => ({
    action: row.action,
    at: row.created_at,
    userId: row.user_id,
    metadata: row.metadata || {}
  }));
}
