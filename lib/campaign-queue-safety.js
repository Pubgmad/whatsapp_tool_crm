import { AppError, query } from "./db.js";

export async function campaignDispatchState({ campaignId, businessId, contactId }) {
  const current = (await query(
    `SELECT c.status AS campaign_status, ct.marketing_permission, ct.unsubscribed
     FROM campaigns c JOIN contacts ct ON ct.business_id=c.business_id
     WHERE c.id=$1 AND c.business_id=$2 AND ct.id=$3`,
    [campaignId, businessId, contactId]
  )).rows[0];
  if (!current || !["queued", "scheduled", "processing", "paused"].includes(current.campaign_status)) {
    throw new AppError("Campaign is no longer available for delivery.", 409, "CAMPAIGN_UNAVAILABLE");
  }
  if (current.campaign_status === "paused") return "paused";
  if (!current.marketing_permission || current.unsubscribed) {
    throw new AppError("Recipient opted out before delivery.", 409, "RECIPIENT_OPTED_OUT");
  }
  return "ready";
}

export async function updateCampaignCompletion(client, campaignId, businessId) {
  await client.query(
    `UPDATE campaigns c
     SET status = CASE WHEN EXISTS (
       SELECT 1 FROM campaign_recipients cr
       JOIN campaign_jobs j ON j.campaign_recipient_id = cr.id
       WHERE cr.campaign_id = c.id AND j.status IN ('queued', 'retry', 'processing')
     ) THEN 'processing' ELSE 'completed' END
     WHERE c.id = $1 AND c.business_id = $2 AND c.status NOT IN ('paused', 'cancelled')`,
    [campaignId, businessId]
  );
}
