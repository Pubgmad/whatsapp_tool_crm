export function orderAttributionConfidence(order) {
  const referral = order?.referral;
  const hasCampaign = Boolean(order?.campaign_id);
  // normalizeWhatsAppReferral stores camelCase; older rows may still use snake_case.
  const hasReferral =
    referral &&
    typeof referral === 'object' &&
    (referral.sourceId || referral.source_id || referral.ctwaClid || referral.ctwa_clid || referral.headline || referral.sourceType || referral.source_type);
  if (hasCampaign && hasReferral) return { level: 'high', label: 'Campaign and ad referral recorded' };
  if (hasCampaign) return { level: 'medium', label: 'Linked to a campaign recipient' };
  if (hasReferral) return { level: 'medium', label: 'Ad referral present without campaign link' };
  if (order?.source_message_id?.startsWith('flow:')) return { level: 'medium', label: 'Attributed to a WhatsApp Flow session' };
  return { level: 'unknown', label: 'No campaign or ad referral evidence' };
}

export function enrichOrderRow(row) {
  const attribution = orderAttributionConfidence(row);
  return { ...row, attributionLevel: attribution.level, attributionLabel: attribution.label };
}
