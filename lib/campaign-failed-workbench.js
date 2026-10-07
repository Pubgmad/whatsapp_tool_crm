import { query } from './db.js';

export async function campaignFailedRecipientsWorkbench(businessId, limit = 75) {
  const capped = Math.min(Math.max(Number(limit) || 75, 1), 200);
  const total = (
    await query(
      `SELECT COUNT(*)::int AS total
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id=cr.campaign_id
       WHERE c.business_id=$1 AND cr.status='failed'`,
      [businessId]
    )
  ).rows[0];
  const rows = (
    await query(
      `SELECT cr.id, cr.campaign_id, cr.error_message, cr.updated_at,
              j.attempts, j.max_attempts,
              c.name AS campaign_name, c.status AS campaign_status,
              t.name AS contact_name, t.phone AS contact_phone
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id=cr.campaign_id
       JOIN contacts t ON t.id=cr.contact_id
       LEFT JOIN campaign_jobs j ON j.campaign_recipient_id=cr.id
       WHERE c.business_id=$1 AND cr.status='failed'
       ORDER BY cr.updated_at DESC
       LIMIT $2`,
      [businessId, capped]
    )
  ).rows;
  return {
    total: Number(total?.total || 0),
    rows: rows.map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      campaignStatus: row.campaign_status,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      errorMessage: row.error_message || '',
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      updatedAt: row.updated_at
    }))
  };
}
