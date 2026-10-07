import { id } from './db.js';
import { resolveSegmentContactIds } from './segments.js';

function renderTemplate(body, contact, variables = {}) {
  return String(body || '').replace(/{{\s*([\w.-]+)\s*}}/g, (_, key) => (key === 'name' ? contact.name : variables[key]) || '');
}

async function loadCampaign(client, businessId, campaignId) {
  return (await client.query('SELECT * FROM campaigns WHERE id=$1 AND business_id=$2', [campaignId, businessId])).rows[0];
}

export async function syncCampaignAudienceFromSegment(businessId, campaignId, client) {
  const campaign = await loadCampaign(client, businessId, campaignId);
  if (!campaign?.audience_segment_id) return { added: 0, removed: 0, total: 0 };
  const segment = (await client.query(
    'SELECT rules FROM audience_segments WHERE id=$1 AND business_id=$2 AND is_active=TRUE',
    [campaign.audience_segment_id, businessId]
  )).rows[0];
  if (!segment) return { added: 0, removed: 0, total: 0 };

  const contactIds = await resolveSegmentContactIds(businessId, segment.rules);
  if (!contactIds.length) return { added: 0, removed: 0, total: 0 };

  const template = (await client.query('SELECT * FROM templates WHERE id=$1 AND business_id=$2', [campaign.template_id, businessId])).rows[0];
  const variables = campaign.variables || {};
  const existing = (await client.query(
    'SELECT id, contact_id, status FROM campaign_recipients WHERE campaign_id=$1',
    [campaignId]
  )).rows;
  const existingByContact = new Map(existing.map((row) => [row.contact_id, row]));
  const targetSet = new Set(contactIds);

  let removed = 0;
  for (const row of existing) {
    if (row.status !== 'queued' || targetSet.has(row.contact_id)) continue;
    await client.query(
      "UPDATE campaign_recipients SET status='failed', error_message='Removed after audience refresh', updated_at=NOW() WHERE id=$1",
      [row.id]
    );
    await client.query("DELETE FROM campaign_jobs WHERE campaign_recipient_id=$1 AND status IN ('queued','retry')", [row.id]);
    removed += 1;
  }

  const eligible = (await client.query(
    `SELECT * FROM contacts WHERE business_id=$1 AND id=ANY($2::text[]) AND marketing_permission=TRUE AND unsubscribed=FALSE`,
    [businessId, contactIds]
  )).rows;

  let added = 0;
  for (const contact of eligible) {
    if (existingByContact.has(contact.id)) continue;
    const recipientId = id('r');
    const message = template ? renderTemplate(template.body, contact, variables) : '';
    await client.query(
      `INSERT INTO campaign_recipients (id, campaign_id, contact_id, message, status) VALUES ($1,$2,$3,$4,'queued')`,
      [recipientId, campaignId, contact.id, message]
    );
    existingByContact.set(contact.id, { id: recipientId, status: 'queued' });
    added += 1;
  }

  return { added, removed, total: eligible.length };
}
