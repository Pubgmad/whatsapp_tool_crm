/**
 * Client-safe plan entitlement helpers (no db/auth/sharp imports).
 * Server code may re-export these from feature-controls.js.
 */

export const WORKSPACE_FEATURES = Object.freeze({
  inbox: 'Shared inbox and replies',
  templates: 'WhatsApp templates',
  segments: 'Audience segments and retargeting',
  whatsapp_flows: 'Native WhatsApp Flows',
  entry_points: 'Links, QR codes and widgets',
  ads: 'Click-to-WhatsApp ads',
  calling: 'WhatsApp calling',
  commerce: 'WhatsApp commerce',
  conversions: 'WhatsApp conversions',
  automation: 'WhatsApp automation',
  campaigns: 'WhatsApp campaigns',
  marketing_messages: 'Marketing Messages API campaigns',
  connectors: 'Store connectors',
  checkout_recovery: 'WhatsApp checkout recovery',
  ai_agent: 'AI support assistant (drafts and knowledge)',
  ai_auto_reply: 'Autonomous AI WhatsApp replies',
  dialogflow_bot: 'Dialogflow CX WhatsApp bot',
  webviews: 'WhatsApp hosted pages',
  crm_sync: 'External CRM contact sync',
  whatsapp_groups: 'WhatsApp Groups (Cloud API)'
});

export const featureSettingKey = (feature) => `feature_${feature}_enabled`;

/**
 * Feature gate precedence (highest → lowest authority):
 * 1. Platform-wide availability
 * 2. Subscription plan entitlements (when keys are present)
 * 3. Tenant-specific overrides — can only further restrict
 */
export function resolveFeatureGate({ platformEnabled, planAllows, tenantOverride }) {
  if (!platformEnabled) return false;
  if (!planAllows) return false;
  if (tenantOverride === false) return false;
  return true;
}

function normalizeFeatureToken(item) {
  return String(item || '').trim().toLowerCase().replace(/^feature_/, '').replace(/-/g, '_');
}

/**
 * Extract entitlement keys from a plan.features JSON array.
 * Marketing bullet copy is ignored so legacy catalogues do not deny every feature.
 * Returns null when no entitlement keys are present (no plan-level feature gate).
 */
export function planEntitlementKeys(planFeatures) {
  if (!Array.isArray(planFeatures) || !planFeatures.length) return null;
  const known = new Set(Object.keys(WORKSPACE_FEATURES));
  const keys = [];
  for (const item of planFeatures) {
    const raw = normalizeFeatureToken(item);
    if (known.has(raw)) keys.push(raw);
  }
  return keys.length ? keys : null;
}

/** Human-readable bullets for pricing UI (drops entitlement keys). */
export function planMarketingFeatures(planFeatures) {
  if (!Array.isArray(planFeatures)) return [];
  const known = new Set(Object.keys(WORKSPACE_FEATURES));
  return planFeatures.filter((item) => {
    const raw = normalizeFeatureToken(item);
    return raw && !known.has(raw);
  });
}

export function planAllowsFeature(planFeatures, feature) {
  const keys = planEntitlementKeys(planFeatures);
  if (keys == null) return true;
  return keys.includes(feature);
}
