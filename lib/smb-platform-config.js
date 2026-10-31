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
    rules: [{ matchType: 'contains', pattern: 'hours', synonyms: ['timing', 'open', 'closing'], replyText: 'Share your business hours here, or customize this template in Super Admin.' }]
  },
  {
    id: 'pricing_intro',
    label: 'Pricing intro',
    description: 'Acknowledge price questions and ask for the product.',
    enabled: true,
    version: 1,
    fallbackText: 'Thanks — a teammate will share pricing shortly.',
    rules: [{ matchType: 'any_keyword', pattern: 'price', synonyms: ['cost', 'fee', 'rate'], replyText: 'Happy to help with pricing. Which product or service are you asking about?' }]
  }
]);

const DEFAULT_ONBOARDING_GOALS = Object.freeze([
  { id: 'answer_questions', label: 'Answer customer questions automatically', next: 'bots' },
  { id: 'leads', label: 'Capture leads', next: 'campaigns' },
  { id: 'campaigns', label: 'Send promotional campaigns', next: 'campaigns' },
  { id: 'support', label: 'Manage WhatsApp customer support', next: 'inbox' },
  { id: 'checkout_recovery', label: 'Recover abandoned checkouts', next: 'commerce' },
  { id: 'appointments', label: 'Send appointment reminders', next: 'automation' }
]);

const DEFAULT_CONCIERGE_TOPICS = Object.freeze([
  { id: 'meta_connection', label: 'Meta / WhatsApp connection' },
  { id: 'phone_setup', label: 'Phone number setup' },
  { id: 'templates', label: 'Template approval' },
  { id: 'first_campaign', label: 'First campaign' },
  { id: 'sheets_bot', label: 'Google Sheets bot' },
  { id: 'ecommerce', label: 'Ecommerce integration' },
  { id: 'automation', label: 'First automation' }
]);

const DEFAULT_ZOHO_POLICY = Object.freeze({
  intervalMinutes: 15,
  minIntervalMinutes: 5,
  maxIntervalMinutes: 1440,
  modules: ['Contacts', 'Leads'],
  accountsHost: 'https://accounts.zoho.com',
  phoneFields: ['Phone', 'Mobile', 'Other_Phone'],
  nameFields: ['Full_Name', 'Last_Name', 'First_Name', 'Company', 'Email']
});

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

export async function getOnboardingGoals() {
  const raw = await readJsonSetting('smb_onboarding_goals', DEFAULT_ONBOARDING_GOALS);
  const list = Array.isArray(raw) ? raw : DEFAULT_ONBOARDING_GOALS;
  return list
    .filter((item) => item && item.id && item.label)
    .map((item) => ({
      id: String(item.id).slice(0, 64),
      label: String(item.label).slice(0, 160),
      next: String(item.next || 'bots').slice(0, 64)
    }));
}

export async function getConciergeTopics() {
  const raw = await readJsonSetting('smb_concierge_topics', DEFAULT_CONCIERGE_TOPICS);
  const list = Array.isArray(raw) ? raw : DEFAULT_CONCIERGE_TOPICS;
  return list
    .filter((item) => item && item.id && item.label)
    .map((item) => ({
      id: String(item.id).slice(0, 80),
      label: String(item.label).slice(0, 120)
    }));
}

export async function getZohoSyncPolicy() {
  const raw = await readJsonSetting('smb_zoho_sync_policy', DEFAULT_ZOHO_POLICY);
  const min = clampInt(raw.minIntervalMinutes, 1, 1440, DEFAULT_ZOHO_POLICY.minIntervalMinutes);
  const max = clampInt(raw.maxIntervalMinutes, min, 1440, DEFAULT_ZOHO_POLICY.maxIntervalMinutes);
  const modules = Array.isArray(raw.modules) && raw.modules.length
    ? raw.modules.map((item) => String(item)).filter((item) => ['Contacts', 'Leads', 'Accounts'].includes(item))
    : [...DEFAULT_ZOHO_POLICY.modules];
  return {
    intervalMinutes: clampInt(raw.intervalMinutes, min, max, DEFAULT_ZOHO_POLICY.intervalMinutes),
    minIntervalMinutes: min,
    maxIntervalMinutes: max,
    modules: modules.length ? modules : [...DEFAULT_ZOHO_POLICY.modules],
    accountsHost: String(raw.accountsHost || DEFAULT_ZOHO_POLICY.accountsHost).replace(/\/$/, ''),
    phoneFields: Array.isArray(raw.phoneFields) && raw.phoneFields.length
      ? raw.phoneFields.map((item) => String(item).slice(0, 64)).slice(0, 10)
      : [...DEFAULT_ZOHO_POLICY.phoneFields],
    nameFields: Array.isArray(raw.nameFields) && raw.nameFields.length
      ? raw.nameFields.map((item) => String(item).slice(0, 64)).slice(0, 10)
      : [...DEFAULT_ZOHO_POLICY.nameFields]
  };
}

const DEFAULT_FALLBACK = 'Thanks — a teammate will follow up shortly.';

export async function getDefaultFallbackReply() {
  const raw = await readJsonSetting('smb_default_fallback', DEFAULT_FALLBACK);
  const text = typeof raw === 'string' ? raw : (raw?.text || DEFAULT_FALLBACK);
  return String(text || DEFAULT_FALLBACK).slice(0, 1000);
}

export {
  DEFAULT_SHEETS_SYNC,
  DEFAULT_PROVIDERS,
  DEFAULT_PLAYBOOKS,
  DEFAULT_BOT_TEMPLATES,
  DEFAULT_ONBOARDING_GOALS,
  DEFAULT_CONCIERGE_TOPICS,
  DEFAULT_ZOHO_POLICY,
  DEFAULT_FALLBACK
};
