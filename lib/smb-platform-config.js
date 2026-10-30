import { query } from './db.js';

const DEFAULT_SHEETS_SYNC = Object.freeze({
  pollIntervalMinutes: 5,
  minIntervalMinutes: 2,
  maxIntervalMinutes: 60,
  maxRowsPerSync: 5000,
  maxBotsPerWorkspace: 10,
  retryLimit: 3,
  matchModes: ['exact', 'keyword', 'normalized']
});

const DEFAULT_PROVIDERS = Object.freeze([
  { id: 'google_sheets', label: 'Google Sheets', kind: 'oauth', category: 'bots', feature: 'sheets_bot', summary: 'Use a spreadsheet as your WhatsApp FAQ or product reply brain.', docsPath: '/app/bots', enabled: true, adapter: 'google_sheets' },
  { id: 'zoho_crm', label: 'Zoho CRM', kind: 'oauth', category: 'crm', feature: 'crm_sync', summary: 'Sync contacts and leads from Zoho into MathStrat.', docsPath: '/app/settings/integrations', enabled: true, adapter: 'zoho_crm' },
  { id: 'zapier', label: 'Zapier', kind: 'webhook', category: 'automation', feature: 'connectors', summary: 'Send CRM events to Zapier and receive authorized actions via signed webhooks.', docsPath: '/app/settings/integrations', enabled: true, adapter: 'zapier' },
  { id: 'pabbly', label: 'Pabbly Connect', kind: 'webhook', category: 'automation', feature: 'connectors', summary: 'Connect Pabbly workflows with inbound/outbound WhatsApp CRM webhooks.', docsPath: '/app/settings/integrations', enabled: true, adapter: 'pabbly' },
  { id: 'shopify', label: 'Shopify', kind: 'oauth', category: 'commerce', feature: 'connectors', summary: 'Orders, checkouts, and ecommerce playbooks.', docsPath: '/app/settings/integrations', enabled: true, adapter: 'shopify' },
  { id: 'woocommerce', label: 'WooCommerce', kind: 'webhook', category: 'commerce', feature: 'connectors', summary: 'Signed store webhooks for orders and recovery playbooks.', docsPath: '/app/settings/integrations', enabled: true, adapter: 'woocommerce' }
]);

/** Adapters implemented in code — Super Admin can hide/show, not invent new executable adapters. */
export const MARKETPLACE_ADAPTERS = Object.freeze(new Set(DEFAULT_PROVIDERS.map((item) => item.adapter)));

const DEFAULT_PLAYBOOKS = Object.freeze([
  { id: 'abandoned_checkout_recovery', label: 'Abandoned checkout recovery', provider: 'shopify', description: 'Remind eligible shoppers who left checkout.', kind: 'checkout_recovery', defaultDelayMinutes: 60, enabled: true, version: 1 },
  { id: 'woo_abandoned_checkout_recovery', label: 'WooCommerce checkout recovery', provider: 'woocommerce', description: 'Recover eligible abandoned WooCommerce checkouts.', kind: 'checkout_recovery', defaultDelayMinutes: 60, enabled: true, version: 1 }
]);

const DEFAULT_BOT_TEMPLATES = Object.freeze([
  {
    id: 'faq_hours',
    label: 'Business hours FAQ',
    description: 'Answer common hours questions.',
    enabled: true,
    version: 1,
    fallbackText: 'Thanks — a teammate will follow up shortly.',
    rules: [{ matchType: 'contains', pattern: 'hours', synonyms: ['timing', 'open', 'closing'], replyText: 'We are open Mon–Sat, 10am–7pm. How can we help?' }]
  }
]);

async function readJsonSetting(key, fallback) {
  const row = (await query('SELECT value FROM platform_settings WHERE key=$1', [key])).rows[0];
  if (row?.value == null) return fallback;
  return row.value;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export async function getSheetsSyncPolicy() {
  const raw = await readJsonSetting('smb_sheets_sync_policy', DEFAULT_SHEETS_SYNC);
  const min = clampInt(raw.minIntervalMinutes, 1, 1440, DEFAULT_SHEETS_SYNC.minIntervalMinutes);
  const max = clampInt(raw.maxIntervalMinutes, min, 1440, DEFAULT_SHEETS_SYNC.maxIntervalMinutes);
  const poll = clampInt(raw.pollIntervalMinutes, min, max, DEFAULT_SHEETS_SYNC.pollIntervalMinutes);
  return {
    pollIntervalMinutes: poll,
    minIntervalMinutes: min,
    maxIntervalMinutes: max,
    maxRowsPerSync: clampInt(raw.maxRowsPerSync, 100, 20000, DEFAULT_SHEETS_SYNC.maxRowsPerSync),
    maxBotsPerWorkspace: clampInt(raw.maxBotsPerWorkspace, 1, 100, DEFAULT_SHEETS_SYNC.maxBotsPerWorkspace),
    retryLimit: clampInt(raw.retryLimit, 0, 10, DEFAULT_SHEETS_SYNC.retryLimit),
    matchModes: Array.isArray(raw.matchModes) && raw.matchModes.length
      ? raw.matchModes.filter((mode) => ['exact', 'keyword', 'normalized'].includes(mode))
      : [...DEFAULT_SHEETS_SYNC.matchModes]
  };
}

export async function getMarketplaceProviders() {
  const raw = await readJsonSetting('smb_marketplace_providers', DEFAULT_PROVIDERS);
  const list = Array.isArray(raw) ? raw : DEFAULT_PROVIDERS;
  return list
    .filter((item) => item && item.id && item.adapter && MARKETPLACE_ADAPTERS.has(item.adapter) && item.enabled !== false)
    .map((item) => ({
      id: String(item.id),
      label: String(item.label || item.id).slice(0, 80),
      kind: ['oauth', 'webhook'].includes(item.kind) ? item.kind : 'webhook',
      category: String(item.category || 'integrations').slice(0, 40),
      feature: String(item.feature || 'connectors'),
      summary: String(item.summary || '').slice(0, 400),
      docsPath: String(item.docsPath || '/app/settings/integrations').slice(0, 200),
      enabled: true,
      adapter: item.adapter,
      status: 'available'
    }));
}

export async function getEcommercePlaybookDefs() {
  const raw = await readJsonSetting('smb_ecommerce_playbooks', DEFAULT_PLAYBOOKS);
  const list = Array.isArray(raw) ? raw : DEFAULT_PLAYBOOKS;
  return list
    .filter((item) => item && item.id && item.enabled !== false)
    .filter((item) => ['checkout_recovery', 'commerce_preset'].includes(item.kind))
    .map((item) => ({
      id: String(item.id),
      label: String(item.label || item.id).slice(0, 120),
      provider: String(item.provider || 'shopify'),
      description: String(item.description || '').slice(0, 400),
      kind: item.kind,
      presetId: item.presetId ? String(item.presetId) : undefined,
      defaultDelayMinutes: clampInt(item.defaultDelayMinutes, 0, 43200, 60),
      enabled: true,
      version: clampInt(item.version, 1, 9999, 1),
      requires: item.kind === 'checkout_recovery'
        ? ['connectors', 'checkout_recovery', 'automation']
        : ['commerce', 'automation']
    }));
}

export async function getReplyBotTemplates() {
  const raw = await readJsonSetting('smb_reply_bot_templates', DEFAULT_BOT_TEMPLATES);
  const list = Array.isArray(raw) ? raw : DEFAULT_BOT_TEMPLATES;
  return list
    .filter((item) => item && item.id && item.enabled !== false)
    .map((item) => ({
      id: String(item.id),
      label: String(item.label || item.id).slice(0, 120),
      description: String(item.description || '').slice(0, 400),
      enabled: true,
      version: clampInt(item.version, 1, 9999, 1),
      fallbackText: String(item.fallbackText || '').slice(0, 1000),
      rules: Array.isArray(item.rules)
        ? item.rules.slice(0, 50).map((rule) => ({
          matchType: ['exact', 'contains', 'any_keyword', 'regex'].includes(rule.matchType) ? rule.matchType : 'contains',
          pattern: String(rule.pattern || '').slice(0, 400),
          synonyms: Array.isArray(rule.synonyms) ? rule.synonyms.map((s) => String(s).slice(0, 80)).slice(0, 20) : [],
          replyText: String(rule.replyText || '').slice(0, 1000)
        })).filter((rule) => rule.pattern && rule.replyText)
        : []
    }));
}

export { DEFAULT_SHEETS_SYNC, DEFAULT_PROVIDERS, DEFAULT_PLAYBOOKS, DEFAULT_BOT_TEMPLATES };
