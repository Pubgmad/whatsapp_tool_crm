import { AppError, query, toIso } from "./db.js";

import { WORKSPACE_FEATURES, featureSettingKey } from './feature-controls.js';
import {brandAssets} from './public-site.js';
import { defaultRetargetingPresetCatalog } from './retargeting-presets.js';
import { defaultIntegrationCatalog } from './integration-catalog-data.js';

export const PUBLIC_PLATFORM_DEFAULTS = {
  brand_name: {
    label: "Brand name",
    category: "branding",
    valueType: "text",
    public: true,
    displayOrder: 10,
    value: "WhatsApp CRM"
  },
  product_tagline: {
    label: "Product tagline",
    category: "branding",
    valueType: "text",
    public: true,
    displayOrder: 20,
    value: "WhatsApp Business CRM"
  },
  company_name: {
    label: "Platform company name",
    category: "company",
    valueType: "text",
    public: true,
    displayOrder: 30,
    value: "Platform operator"
  },
  support_email: {
    label: "Support email",
    category: "company",
    valueType: "text",
    public: true,
    displayOrder: 40,
    value: ""
  },
  workspace_intro: {
    label: "Workspace intro",
    category: "crm_content",
    valueType: "rich_text",
    public: true,
    displayOrder: 50,
    value: "Manage opted-in WhatsApp contacts, approved templates, campaign delivery, customer replies, automation, and unsubscribe safety from one business workspace."
  },
  signin_heading: {
    label: "Sign in heading",
    category: "auth_content",
    valueType: "text",
    public: true,
    displayOrder: 60,
    value: "Sign in"
  },
  signin_copy: {
    label: "Sign in copy",
    category: "auth_content",
    valueType: "rich_text",
    public: true,
    displayOrder: 70,
    value: "Continue to your WhatsApp campaign workspace."
  },
  signup_heading: {
    label: "Sign up heading",
    category: "auth_content",
    valueType: "text",
    public: true,
    displayOrder: 80,
    value: "Create workspace"
  },
  signup_copy: {
    label: "Sign up copy",
    category: "auth_content",
    valueType: "rich_text",
    public: true,
    displayOrder: 90,
    value: "Start with your business account and connect Meta after login."
  },
  primary_cta_label: {
    label: "Primary CTA label",
    category: "crm_content",
    valueType: "text",
    public: true,
    displayOrder: 100,
    value: "New campaign"
  },
  public_signup_label: { label: 'Public signup button', category: 'public_site', valueType: 'text', public: true, displayOrder: 101, value: 'Create workspace' },
  public_pricing_heading: { label: 'Pricing heading', category: 'public_site', valueType: 'text', public: true, displayOrder: 102, value: 'Plans' },
  public_signin_label: { label: 'Public sign-in link label', category: 'public_site', valueType: 'text', public: true, displayOrder: 103, value: 'Sign in' },
  public_default_footer_links: {
    label: 'Default public footer links (merged with CMS footer)',
    category: 'public_site',
    valueType: 'json',
    public: false,
    displayOrder: 104,
    value: [
      { label: 'About', href: '/about' },
      { label: 'Privacy', href: '/privacy-policy' }
    ]
  },
  privacy_last_updated: {
    label: "Privacy policy last updated",
    category: "legal",
    valueType: "text",
    public: true,
    displayOrder: 110,
    value: "6 September 2026"
  },
  privacy_intro: {
    label: "Privacy policy intro",
    category: "legal",
    valueType: "rich_text",
    public: true,
    displayOrder: 120,
    value: "This policy explains how the platform collects, uses, stores, shares, and protects data when companies use it to manage WhatsApp Business contacts, templates, campaigns, inbox replies, automation, and subscription services."
  }
};

export const OPERATIONAL_PLATFORM_DEFAULTS = {
  ...Object.fromEntries(Object.entries(WORKSPACE_FEATURES).map(([feature, label], index) => [featureSettingKey(feature), { label, category: 'feature_controls', valueType: 'boolean', public: false, displayOrder: 400 + index, value: feature !== 'checkout_recovery' }])),
  whatsapp_calling_access: { label: 'WhatsApp calling roles and owner delegation', category: 'whatsapp_operations', valueType: 'json', public: false, displayOrder: 475, value: { roles: ['Owner','Manager','Agent'], allowTenantConfiguration: true } },
  ai_daily_request_limit: { label: 'Daily AI requests per company', category: 'feature_controls', valueType: 'number', public: false, displayOrder: 476, value: 100 },
  saas_billing_provider: { label: 'SaaS subscription provider (razorpay only)', category: 'billing', valueType: 'text', public: false, displayOrder: 478, value: 'razorpay' },
  razorpay_subscription_total_count: { label: 'Razorpay subscription billing cycles (configure before enabling checkout)', category: 'billing', valueType: 'number', public: false, displayOrder: 480, value: 0 },
  security_event_retention_days: { label: 'Security event retention days', category: 'data_governance', valueType: 'number', public: false, displayOrder: 500, value: 365 },
  webhook_event_retention_days: { label: 'Webhook event retention days', category: 'data_governance', valueType: 'number', public: false, displayOrder: 510, value: 90 },
  completed_job_retention_days: { label: 'Completed job retention days', category: 'data_governance', valueType: 'number', public: false, displayOrder: 520, value: 30 },
  message_retention_days: { label: 'Message retention days (0 keeps messages)', category: 'data_governance', valueType: 'number', public: false, displayOrder: 530, value: 0 },
  message_usage_retention_days: { label: 'Usage record retention days (0 keeps records; minimum 35)', category: 'data_governance', valueType: 'number', public: false, displayOrder: 535, value: 400 },
  workspace_deletion_grace_days: { label: 'Workspace deletion grace days', category: 'data_governance', valueType: 'number', public: false, displayOrder: 540, value: 30 },
  ai_autonomous_actions_enabled: {
    label: 'Allow workspace autonomous AI actions (platform gate)',
    category: 'feature_controls',
    valueType: 'boolean',
    public: false,
    displayOrder: 477,
    value: false
  },
  retargeting_preset_catalog: {
    label: 'WhatsApp retargeting preset labels',
    category: 'crm_content',
    valueType: 'json',
    public: false,
    displayOrder: 106,
    value: defaultRetargetingPresetCatalog()
  },
  campaign_queue_max_lag_seconds: {
    label: 'Campaign queue SLO max lag (seconds)',
    category: 'feature_controls',
    valueType: 'number',
    public: false,
    displayOrder: 479,
    value: 600
  },
  integration_catalog: {
    label: 'Integration catalog shown to workspace owners',
    category: 'crm_content',
    valueType: 'json',
    public: false,
    displayOrder: 107,
    value: defaultIntegrationCatalog()
  },
  slo_require_load_test_record: {
    label: 'Require VPS load-test attestation for SLO certification',
    category: 'feature_controls',
    valueType: 'boolean',
    public: false,
    displayOrder: 480,
    value: false
  },
  slo_max_rate_limit_events_24h: {
    label: 'SLO max Meta 429 send events in 24h (platform)',
    category: 'feature_controls',
    valueType: 'number',
    public: false,
    displayOrder: 481,
    value: 500
  },
  slo_max_terminal_send_failures_24h: {
    label: 'SLO max terminal campaign send failures in 24h',
    category: 'feature_controls',
    valueType: 'number',
    public: false,
    displayOrder: 482,
    value: 200
  },
  mm_marketing_message_ttl_seconds: {
    label: 'Documented MM API TTL hint (seconds; send still Meta-controlled)',
    category: 'feature_controls',
    valueType: 'number',
    public: false,
    displayOrder: 483,
    value: 0
  }
};

const LEGACY_PRIVACY_KEYS = new Set(["privacy_intro", "privacy_last_updated"]);

function clean(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

export function normalizePlatformValue(value, valueType = "text") {
  if (valueType === "json") {
    if (value === undefined) throw new AppError("Enter valid JSON.", 400, "VALIDATION_ERROR");
    try { return typeof value === "string" ? JSON.parse(value) : value; }
    catch { throw new AppError("Enter valid JSON.", 400, "VALIDATION_ERROR"); }
  }
  if (valueType === "boolean") {
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
    throw new AppError("Enter true or false.", 400, "VALIDATION_ERROR");
  }
  if (valueType === "number") {
    if (value === null || value === undefined || String(value).trim() === "" || !Number.isFinite(Number(value))) {
      throw new AppError("Enter a valid number.", 400, "VALIDATION_ERROR");
    }
    return Number(value);
  }
  return String(value ?? "");
}

export function defaultPlatformConfig() {
  return Object.fromEntries(Object.entries(PUBLIC_PLATFORM_DEFAULTS).filter(([key]) => !LEGACY_PRIVACY_KEYS.has(key)).map(([key, item]) => [key, platformSeedValue(key, item.value)]));
}

function platformSeedValue(key, fallback) {
  const envName = { brand_name: "PLATFORM_BRAND_NAME", company_name: "PLATFORM_COMPANY_NAME", support_email: "PLATFORM_SUPPORT_EMAIL" }[key];
  return envName ? process.env[envName] || fallback : fallback;
}

export async function seedPlatformSettings(client) {
  for (const [key, item] of Object.entries({ ...PUBLIC_PLATFORM_DEFAULTS, ...OPERATIONAL_PLATFORM_DEFAULTS })) {
    await client.query(
      `INSERT INTO platform_settings (id, key, label, category, value, value_type, is_public, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (key) DO NOTHING`,
      [`ps_${key}`, key, item.label, item.category, JSON.stringify(platformSeedValue(key, item.value)), item.valueType, item.public, item.displayOrder]
    );
  }
}

export async function getPlatformSettingValue(key, fallback = null) {
  try {
    const row = (await query('SELECT value FROM platform_settings WHERE key=$1', [key])).rows[0];
    return row ? row.value : fallback;
  } catch (error) {
    if (error?.code === 'DB_NOT_CONFIGURED' || error?.code === '42P01') return fallback;
    throw error;
  }
}

export async function buildKnowledgeImportUserAgent() {
  const brand = clean(await getPlatformSettingValue('brand_name', platformSeedValue('brand_name', PUBLIC_PLATFORM_DEFAULTS.brand_name.value)));
  const slug = brand.replace(/[^\w]+/g, '').slice(0, 48) || 'Platform';
  return `${slug}KnowledgeImporter/1.0`;
}

export async function getPublicPlatformConfig() {
  const defaults = defaultPlatformConfig();
  try {
    const result = await query("SELECT key, value FROM platform_settings WHERE is_public = TRUE ORDER BY display_order ASC, key ASC");
    for (const row of result.rows) if (!LEGACY_PRIVACY_KEYS.has(row.key)) defaults[row.key] = row.value;
  } catch (error) {
    if (error?.code !== "DB_NOT_CONFIGURED" && error?.code !== "42P01") throw error;
  }
  try {
    const assets=await brandAssets();
    defaults.logo_url=assets.logo?.url||'';
    defaults.favicon_url=assets.favicon?.url||'';
  } catch(error){if(error?.code!=='DB_NOT_CONFIGURED'&&error?.code!=='42P01')throw error;}
  return defaults;
}

export async function listPlatformSettings() {
  const result = await query("SELECT * FROM platform_settings WHERE key NOT IN ('privacy_intro','privacy_last_updated') ORDER BY category ASC, display_order ASC, key ASC");
  return result.rows.map(mapPlatformSetting);
}

export async function upsertPlatformSetting(body) {
  const key = normalizeKey(body.key);
  const label = clean(body.label);
  const category = clean(body.category) || "general";
  const valueType = clean(body.valueType || body.value_type) || "text";
  if (!key || !label) throw new AppError("Setting key and label are required.", 400, "VALIDATION_ERROR");
  if (!["text", "rich_text", "image_url", "json", "boolean", "number"].includes(valueType)) throw new AppError("Unsupported setting type.", 400, "VALIDATION_ERROR");

  const feature = Object.keys(WORKSPACE_FEATURES).find(name => featureSettingKey(name) === key);
  if (key.startsWith('feature_') && !feature) throw new AppError('Unknown feature control.', 400, 'VALIDATION_ERROR');
  if (feature && (valueType !== 'boolean' || Boolean(body.isPublic ?? body.is_public))) throw new AppError('Feature controls must be private boolean settings.', 400, 'VALIDATION_ERROR');
  const normalized = normalizePlatformValue(body.value, valueType);
  if (key === 'ai_daily_request_limit' && (valueType !== 'number' || !Number.isSafeInteger(normalized) || normalized < 0 || normalized > 100000 || Boolean(body.isPublic ?? body.is_public))) throw new AppError('Daily AI limit must be a private whole number from 0 to 100000.',400,'VALIDATION_ERROR');
  const result = await query(
    `INSERT INTO platform_settings (id, key, label, category, value, value_type, is_public, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (key) DO UPDATE
     SET label = EXCLUDED.label,
         category = EXCLUDED.category,
         value = EXCLUDED.value,
         value_type = EXCLUDED.value_type,
         is_public = EXCLUDED.is_public,
         display_order = EXCLUDED.display_order,
         updated_at = NOW()
     RETURNING *`,
    [`ps_${key}`, key, label, category, JSON.stringify(normalized), valueType, Boolean(body.isPublic ?? body.is_public), Number(body.displayOrder ?? body.display_order) || 0]
  );
  return mapPlatformSetting(result.rows[0]);
}

export function mapPlatformSetting(row) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    category: row.category,
    value: row.value,
    valueType: row.value_type,
    isPublic: Boolean(row.is_public),
    displayOrder: Number(row.display_order || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}
