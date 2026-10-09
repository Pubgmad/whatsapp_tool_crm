import { id } from './db.js';

/**
 * Records template button, interactive button, and list replies for attribution
 * (campaign recipient linkage + journey analytics), including non-tracked CTAs.
 */
export async function recordInteractiveButtonAttribution(
  client,
  { businessId, contactId, messageId, campaignRecipientId = null, buttonId = '', title = '', kind = 'unknown', at = new Date() }
) {
  const payload = String(buttonId || title || '').trim();
  if (!businessId || !contactId || !messageId || !payload) return false;
  await client.query(
    `INSERT INTO events (id, business_id, type, contact_id, metadata, at)
     VALUES ($1, $2, 'interactive_button_reply', $3, $4, $5)`,
    [
      id('e'),
      businessId,
      contactId,
      JSON.stringify({
        messageId,
        campaignRecipientId,
        buttonId: String(buttonId || '').slice(0, 256),
        title: String(title || '').slice(0, 256),
        kind: String(kind || 'unknown').slice(0, 32)
      }),
      at
    ]
  );
  return true;
}
