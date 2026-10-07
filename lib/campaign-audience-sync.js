import { id, query } from './db.js';
import { resolveSegmentContactIds } from './segments.js';
import { refreshRetargetSegmentRules } from './retargeting-segment-refresh.js';

const DEFAULT_SYNC_MINUTES = 15;

export function dynamicAudienceSyncIntervalMs() {
  const minutes = Number(process.env.DYNAMIC_AUDIENCE_SYNC_MINUTES);
  if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440) return minutes * 60 * 1000;
  return DEFAULT_SYNC_MINUTES * 60 * 1000;
}

export async function refreshDynamicCampaignAudiences(businessId = '') {
  const intervalSeconds = Math.max(60, Math.floor(dynamicAudienceSyncIntervalMs() / 1000));
  const campaigns = (
    await query(
      `SELECT id, business_id FROM campaigns
       WHERE dynamic_audience=TRUE AND audience_segment_id IS NOT NULL
         AND status IN ('queued','scheduled','processing','paused')
         AND ($1='' OR business_id=$1)
         AND (audience_synced_at IS NULL OR audience_synced_at < NOW() - ($2::int * INTERVAL '1 second'))
       ORDER BY audience_synced_at NULLS FIRST
       LIMIT 20`,
      [businessId, intervalSeconds]
    )
  ).rows;
  const summary = { campaigns: campaigns.length, added: 0, removed: 0 };
  const { transaction } = await import('./db.js');
  for (const campaign of campaigns) {
    const result = await transaction(async (client) => {
      const stats = await syncCampaignAudienceFromSegment(campaign.business_id, campaign.id, client);
      await client.query('UPDATE campaigns SET audience_synced_at=NOW() WHERE id=$1', [campaign.id]);
      return stats;
    });
    summary.added += result.added;
    summary.removed += result.removed;
  }
  return summary;
}

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
    'SELECT * FROM audience_segments WHERE id=$1 AND business_id=$2 AND is_active=TRUE',
    [campaign.audience_segment_id, businessId]
  )).rows[0];
  if (!segment) return { added: 0, removed: 0, total: 0 };

  const refresh = await refreshRetargetSegmentRules(client, businessId, segment);
  const rules = refresh.refreshed ? refresh.rules : segment.rules;
  const contactIds = await resolveSegmentContactIds(businessId, rules);
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

  await client.query('UPDATE campaigns SET audience_synced_at=NOW() WHERE id=$1 AND business_id=$2', [campaignId, businessId]);
  return { added, removed, total: eligible.length };
}
