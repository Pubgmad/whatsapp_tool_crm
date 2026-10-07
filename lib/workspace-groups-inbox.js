import { query, toIso } from './db.js';

/**
 * Surfaces synced WhatsApp groups for inbox-style navigation (group-as-thread when Meta grants Groups API).
 */
export async function loadWorkspaceGroupsInbox(businessId, { limit = 50 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const rows = await query(
    `SELECT id, subject, participant_count, invite_link, sync_status, meta_group_id, updated_at
     FROM whatsapp_groups WHERE business_id=$1 ORDER BY updated_at DESC LIMIT $2`,
    [businessId, capped]
  );
  return {
    groups: rows.rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      participantCount: row.participant_count,
      inviteLink: row.invite_link,
      syncStatus: row.sync_status,
      metaGroupId: row.meta_group_id,
      updatedAt: toIso(row.updated_at),
      inboxKind: 'whatsapp_group'
    }))
  };
}
