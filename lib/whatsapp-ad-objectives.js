export const SUPPORTED_CTWA_OBJECTIVES = Object.freeze([
  { id: 'MESSAGES', label: 'Click to WhatsApp (messages)', supported: true },
  { id: 'CONVERSIONS', label: 'WhatsApp conversions (CTWA)', supported: true }
]);

export const UNSUPPORTED_AD_OBJECTIVES = Object.freeze([
  { id: 'LEAD_GENERATION', label: 'Lead forms on Meta', supported: false, note: 'Use CTWA plus in-app Flows or CRM capture instead.' },
  { id: 'WEBSITE_TRAFFIC', label: 'Website traffic campaigns', supported: false, note: 'Not managed in this CRM; create in Meta Ads Manager.' },
  { id: 'AUTO_OPTIMIZATION', label: 'Automatic budget optimization', supported: false, note: 'Use experiments and manual changes in Meta.' }
]);

export function adObjectiveCatalog() {
  return { supported: SUPPORTED_CTWA_OBJECTIVES, unsupported: UNSUPPORTED_AD_OBJECTIVES };
}
