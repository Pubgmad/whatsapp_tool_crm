import { buildRetargetRules } from './retargeting-presets.js';

export async function refreshRetargetSegmentRules(client, businessId, segmentRow) {
  const presetId = String(segmentRow?.retarget_preset_id || '').trim();
  const sourceCampaignId = String(segmentRow?.retarget_source_campaign_id || '').trim();
  if (!presetId || !sourceCampaignId) return { refreshed: false };
  const rules = buildRetargetRules(presetId, sourceCampaignId);
  await client.query(
    'UPDATE audience_segments SET rules=$1, updated_at=NOW() WHERE id=$2 AND business_id=$3',
    [JSON.stringify(rules), segmentRow.id, businessId]
  );
  return { refreshed: true, rules };
}
