export const CAMPAIGN_SOURCE_KINDS = Object.freeze([
  'workspace_broadcast',
  'public_api',
  'drip',
  'recurring_child',
  'retarget',
  'legacy',
  'unknown'
]);

const sourceKinds = new Set(CAMPAIGN_SOURCE_KINDS);

export function normalizeCampaignSourceKind(value, fallback = 'unknown') {
  const normalized = String(value || '').trim().toLowerCase();
  return sourceKinds.has(normalized) ? normalized : fallback;
}

export function campaignSourceForWorkspaceCreate({ campaignId, retargetSourceCampaignId } = {}) {
  const retargetId = String(retargetSourceCampaignId || '').trim();
  if (retargetId) return { sourceKind: 'retarget', sourceId: retargetId };
  return { sourceKind: 'workspace_broadcast', sourceId: String(campaignId || '').trim() || null };
}

export function campaignSourceFilter(searchParams) {
  const requestedKind = String(searchParams?.get?.('sourceKind') || '').trim().toLowerCase();
  const sourceId = String(searchParams?.get?.('sourceId') || '').trim().slice(0, 255);
  return {
    sourceKind: sourceKinds.has(requestedKind) ? requestedKind : '',
    sourceId
  };
}
