import { query } from './db.js';

/**
 * Evidence-qualified ad → conversation → order journey (not perfect attribution).
 */
export async function journeyUnifiedReport(businessId, { limit = 50 } = {}) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = (
    await query(
      `SELECT
        c.id AS contact_id,
        c.name AS contact_name,
        c.phone,
        conv.first_referral,
        conv.first_referral_at,
        (SELECT COUNT(*)::int FROM whatsapp_orders o WHERE o.business_id=$1 AND o.contact_id=c.id) AS orders,
        (SELECT COUNT(*)::int FROM campaign_recipients cr JOIN campaigns camp ON camp.id=cr.campaign_id
          WHERE camp.business_id=$1 AND cr.contact_id=c.id AND cr.status IN ('delivered','read')) AS campaign_delivered,
        (SELECT COUNT(*)::int FROM events e WHERE e.business_id=$1 AND e.contact_id=c.id AND e.type='interactive_button_reply') AS button_replies,
        (SELECT COUNT(*)::int FROM tracked_link_tokens tk WHERE tk.business_id=$1 AND tk.contact_id=c.id AND tk.confirmed_at IS NOT NULL) AS tracked_clicks
       FROM contacts c
       LEFT JOIN LATERAL (
         SELECT first_referral, first_referral_at FROM conversations cv
         WHERE cv.business_id=c.business_id AND cv.contact_id=c.id
         ORDER BY cv.updated_at DESC LIMIT 1
       ) conv ON TRUE
       WHERE c.business_id=$1
       ORDER BY GREATEST(c.last_message_at, conv.first_referral_at) DESC NULLS LAST
       LIMIT $2`,
      [businessId, capped]
    )
  ).rows;
  return rows.map((row) => {
    const hasReferral = Boolean(row.first_referral);
    const hasCampaign = Number(row.campaign_delivered) > 0;
    const hasClick = Number(row.tracked_clicks) > 0 || Number(row.button_replies) > 0;
    const hasOrder = Number(row.orders) > 0;
    let confidence = 'unknown';
    if (hasOrder && (hasReferral || hasCampaign || hasClick)) confidence = 'evidence_qualified';
    else if (hasOrder) confidence = 'order_only';
    else if (hasReferral || hasCampaign) confidence = 'touch_only';
    return {
      contactId: row.contact_id,
      name: row.contact_name,
      phone: row.phone,
      referral: row.first_referral,
      referralAt: row.first_referral_at,
      orders: Number(row.orders),
      campaignDelivered: Number(row.campaign_delivered),
      buttonReplies: Number(row.button_replies),
      trackedClicks: Number(row.tracked_clicks),
      attributionConfidence: confidence
    };
  });
}
