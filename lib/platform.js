import { AppError, query, toIso } from "./db.js";

export const PUBLIC_PLATFORM_DEFAULTS = {
  brand_name: {
    label: "Brand name",
    category: "branding",
    valueType: "text",
    public: true,
    displayOrder: 10,
    value: "Growth Desk"
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
    value: "Mathstrat"
  },
  support_email: {
    label: "Support email",
    category: "company",
    valueType: "text",
    public: true,
    displayOrder: 40,
    value: "mathstratofficial@gmail.com"
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

function clean(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeValue(value, valueType = "text") {
  if (valueType === "json") return typeof value === "string" ? JSON.parse(value || "{}") : value || {};
  if (valueType === "boolean") return Boolean(value);
  if (valueType === "number") return Number(value) || 0;
  return String(value ?? "");
}

export function defaultPlatformConfig() {
  return Object.fromEntries(Object.entries(PUBLIC_PLATFORM_DEFAULTS).map(([key, item]) => [key, item.value]));
}

export async function seedPlatformSettings(client) {
  for (const [key, item] of Object.entries(PUBLIC_PLATFORM_DEFAULTS)) {
    await client.query(
      `INSERT INTO platform_settings (id, key, label, category, value, value_type, is_public, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (key) DO NOTHING`,
      [`ps_${key}`, key, item.label, item.category, JSON.stringify(item.value), item.valueType, item.public, item.displayOrder]
    );
  }
}

export async function getPublicPlatformConfig() {
  const defaults = defaultPlatformConfig();
  try {
    const result = await query("SELECT key, value FROM platform_settings WHERE is_public = TRUE ORDER BY display_order ASC, key ASC");
    for (const row of result.rows) defaults[row.key] = row.value;
  } catch (error) {
    if (error?.code !== "DB_NOT_CONFIGURED" && error?.code !== "42P01") throw error;
  }
  return defaults;
}

export async function listPlatformSettings() {
  const result = await query("SELECT * FROM platform_settings ORDER BY category ASC, display_order ASC, key ASC");
  return result.rows.map(mapPlatformSetting);
}

export async function upsertPlatformSetting(body) {
  const key = normalizeKey(body.key);
  const label = clean(body.label);
  const category = clean(body.category) || "general";
  const valueType = clean(body.valueType || body.value_type) || "text";
  if (!key || !label) throw new AppError("Setting key and label are required.", 400, "VALIDATION_ERROR");
  if (!["text", "rich_text", "image_url", "json", "boolean", "number"].includes(valueType)) throw new AppError("Unsupported setting type.", 400, "VALIDATION_ERROR");

  const normalized = normalizeValue(body.value, valueType);
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