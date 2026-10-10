export const SUPPORTED_CTWA_OBJECTIVES = Object.freeze([
  { id: 'MESSAGES', label: 'Click to WhatsApp (messages)', supported: true, requires: ['imageHash', 'headline', 'text'] },
  {
    id: 'WHATSAPP_STATUS',
    label: 'WhatsApp Status + Instagram story placement (CTWA)',
    supported: true,
    requires: ['imageHash', 'headline', 'text'],
    note: 'Uses Meta placement targeting: whatsapp status + Instagram story. Account eligibility is decided by Meta.'
  },
  {
    id: 'LEAD_GENERATION',
    label: 'Meta lead generation (Instant Form)',
    supported: true,
    requires: ['leadGenFormId', 'headline', 'text'],
    note: 'Creates an OUTCOME_LEADS campaign. Leads ingest via Page leadgen webhooks or Ads → Lead form sync; marketing WhatsApp send still requires recorded consent.'
  },
  {
    id: 'WEBSITE_TRAFFIC',
    label: 'Website traffic (link clicks)',
    supported: true,
    requires: ['websiteUrl', 'headline', 'text', 'imageHash'],
    note: 'Drives clicks to your site. Pair with CTWA or Flows for WhatsApp follow-up.'
  }
]);

export const UNSUPPORTED_AD_OBJECTIVES = Object.freeze([
  { id: 'AUTO_OPTIMIZATION', label: 'Automatic budget optimization', supported: false, note: 'Use experiments and manual changes in Meta.' },
  { id: 'APP_INSTALLS', label: 'App install campaigns', supported: false, note: 'Create in Meta Ads Manager.' }
]);

export function adObjectiveCatalog() {
  return { supported: SUPPORTED_CTWA_OBJECTIVES, unsupported: UNSUPPORTED_AD_OBJECTIVES };
}

export function normalizeAdObjectiveKind(value) {
  const kind = String(value || 'MESSAGES').trim().toUpperCase();
  if (kind === 'WHATSAPP_STATUS') return 'WHATSAPP_STATUS';
  if (SUPPORTED_CTWA_OBJECTIVES.some((item) => item.id === kind)) return kind;
  return 'MESSAGES';
}
