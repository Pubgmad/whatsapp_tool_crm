import crypto from "node:crypto";
import fs from "node:fs/promises";
import process from "node:process";
import nextEnv from "@next/env";
import pg from "pg";
import { seedPlatformSettings } from "../lib/platform.js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Example: postgresql://postgres:password@localhost:5432/whatsapp_crm");
  process.exit(1);
}

const schema = (await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8")).replace(/^\uFEFF/, "");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
});

function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(value), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function clean(value) {
  return String(value || "").trim();
}

function optionalNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parsePlans() {
  const raw = clean(process.env.SUBSCRIPTION_PLANS_JSON);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("SUBSCRIPTION_PLANS_JSON must be a valid JSON array.");
  }
}

async function addConstraintIfMissing(client, table, name, expression) {
  const existing = await client.query("SELECT 1 FROM pg_constraint WHERE conname = $1", [name]);
  if (!existing.rows[0]) await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${expression}`);
}

async function seedSubscriptionPlans(client) {
  const plans = parsePlans();
  for (const plan of plans) {
    const code = clean(plan.code).toLowerCase();
    const name = clean(plan.name);
    if (!code || !name) continue;
    const monthlyPrice = optionalNumber(plan.monthlyPriceCents, plan.monthly_price_cents, plan.priceCents, plan.price_cents) || 0;
    const yearlyPrice = optionalNumber(plan.yearlyPriceCents, plan.yearly_price_cents) || 0;

    await client.query(
      `INSERT INTO subscription_plans (id, code, name, description, billing_interval, price_cents, monthly_price_cents, yearly_price_cents, currency, trial_days, contact_limit, campaign_limit, user_limit, automation_flow_limit, monthly_message_limit, whatsapp_conversation_limit, features, display_order, visible, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           description = EXCLUDED.description,
           billing_interval = EXCLUDED.billing_interval,
           price_cents = EXCLUDED.price_cents,
           monthly_price_cents = EXCLUDED.monthly_price_cents,
           yearly_price_cents = EXCLUDED.yearly_price_cents,
           currency = EXCLUDED.currency,
           trial_days = EXCLUDED.trial_days,
           contact_limit = EXCLUDED.contact_limit,
           campaign_limit = EXCLUDED.campaign_limit,
           user_limit = EXCLUDED.user_limit,
           automation_flow_limit = EXCLUDED.automation_flow_limit,
           monthly_message_limit = EXCLUDED.monthly_message_limit,
           whatsapp_conversation_limit = EXCLUDED.whatsapp_conversation_limit,
           features = EXCLUDED.features,
           display_order = EXCLUDED.display_order,
           visible = EXCLUDED.visible,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()`,
      [
        `plan_${crypto.randomBytes(8).toString("hex")}`,
        code,
        name,
        clean(plan.description),
        clean(plan.billingInterval || plan.billing_interval || "monthly"),
        monthlyPrice,
        monthlyPrice,
        yearlyPrice,
        clean(plan.currency || "INR"),
        optionalNumber(plan.trialDays, plan.trial_days) || 0,
        optionalNumber(plan.contactLimit, plan.contact_limit),
        optionalNumber(plan.campaignLimit, plan.campaign_limit),
        optionalNumber(plan.userLimit, plan.user_limit),
        optionalNumber(plan.automationFlowLimit, plan.automation_flow_limit),
        optionalNumber(plan.monthlyMessageLimit, plan.monthly_message_limit),
        optionalNumber(plan.whatsappConversationLimit, plan.whatsapp_conversation_limit),
        JSON.stringify(Array.isArray(plan.features) ? plan.features : []),
        optionalNumber(plan.displayOrder, plan.display_order) || 0,
        plan.visible === false ? false : true,
        plan.isActive === false || plan.is_active === false ? false : true
      ]
    );
  }
}

async function backfillSubscriptions(client) {
  const defaultCode = clean(process.env.DEFAULT_SUBSCRIPTION_PLAN_CODE).toLowerCase();
  const plan = defaultCode
    ? (await client.query("SELECT id, trial_days FROM subscription_plans WHERE code = $1 AND is_active = TRUE AND visible = TRUE LIMIT 1", [defaultCode])).rows[0]
    : null;

  await client.query(
    `INSERT INTO business_subscriptions (id, business_id, plan_id, status, payment_status, starts_at, trial_ends_at, current_period_start, current_period_end, renews_at)
     SELECT 'sub_' || substr(md5(b.id || clock_timestamp()::text), 1, 16),
            b.id,
            $1,
            CASE WHEN $1::text IS NULL THEN 'pending' ELSE 'trialing' END,
            'none',
            NOW(),
            CASE WHEN $1::text IS NULL THEN NULL ELSE NOW() + ($2 || ' days')::interval END,
            NOW(),
            NOW() + INTERVAL '1 month',
            NOW() + INTERVAL '1 month'
     FROM businesses b
     WHERE NOT EXISTS (SELECT 1 FROM business_subscriptions bs WHERE bs.business_id = b.id)`,
    [plan?.id || null, String(plan?.trial_days || 0)]
  );
}

async function seedSuperAdmin(client) {
  const email = clean(process.env.SUPER_ADMIN_EMAIL).toLowerCase();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "");
  if (!email || !password) return;
  if (password.length < 8) throw new Error("SUPER_ADMIN_PASSWORD must be at least 8 characters.");

  const existing = await client.query("SELECT id FROM super_admins WHERE email = $1", [email]);
  if (existing.rows[0]) return;

  await client.query(
    "INSERT INTO super_admins (id, email, password_hash, active) VALUES ($1, $2, $3, TRUE)",
    [`sa_${crypto.randomBytes(8).toString("hex")}`, email, hashPassword(password)]
  );
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("DO $$ BEGIN IF to_regclass('public.businesses') IS NOT NULL THEN ALTER TABLE businesses ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'; END IF; END $$;");
  await client.query(schema);
  await client.query("CREATE TABLE IF NOT EXISTS platform_audit_logs (id TEXT PRIMARY KEY, super_admin_id TEXT REFERENCES super_admins(id) ON DELETE SET NULL, action TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await client.query("CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_at ON platform_audit_logs(at DESC)");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS automation_flow_limit INTEGER");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS monthly_message_limit INTEGER");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS monthly_price_cents INTEGER NOT NULL DEFAULT 0");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS yearly_price_cents INTEGER NOT NULL DEFAULT 0");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS whatsapp_conversation_limit INTEGER");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '[]'::jsonb");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT TRUE");
  await client.query("UPDATE subscription_plans SET monthly_price_cents = price_cents WHERE monthly_price_cents = 0 AND price_cents <> 0");
  await client.query("CREATE TABLE IF NOT EXISTS platform_settings (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, label TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', value JSONB NOT NULL DEFAULT '{}'::jsonb, value_type TEXT NOT NULL DEFAULT 'text', is_public BOOLEAN NOT NULL DEFAULT FALSE, display_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT platform_settings_type_check CHECK (value_type IN ('text', 'rich_text', 'image_url', 'json', 'boolean', 'number')))");
  await client.query("CREATE INDEX IF NOT EXISTS idx_platform_settings_public ON platform_settings(is_public, category, display_order)");
  await client.query("CREATE INDEX IF NOT EXISTS idx_subscription_plans_display ON subscription_plans(visible, is_active, display_order)");
  await client.query("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS automation_flow_id TEXT");
  await client.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_user_id TEXT");
  await client.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS automation_paused BOOLEAN NOT NULL DEFAULT FALSE");
  await client.query("ALTER TABLE automation_sessions ADD COLUMN IF NOT EXISTS assigned_user_id TEXT");
  await client.query("ALTER TABLE automation_sessions ADD COLUMN IF NOT EXISTS campaign_id TEXT");
  await client.query("CREATE INDEX IF NOT EXISTS idx_campaigns_automation_flow ON campaigns(automation_flow_id)");
  await client.query("CREATE INDEX IF NOT EXISTS idx_conversations_assigned_user ON conversations(assigned_user_id)");
  await addConstraintIfMissing(client, "campaigns", "campaigns_automation_flow_id_fkey", "FOREIGN KEY (automation_flow_id) REFERENCES automation_flows(id) ON DELETE SET NULL");
  await addConstraintIfMissing(client, "conversations", "conversations_assigned_user_id_fkey", "FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL");
  await addConstraintIfMissing(client, "automation_sessions", "automation_sessions_assigned_user_id_fkey", "FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL");
  await addConstraintIfMissing(client, "automation_sessions", "automation_sessions_campaign_id_fkey", "FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL");
  await client.query("ALTER TABLE templates ADD COLUMN IF NOT EXISTS meta_template_name TEXT DEFAULT ''");
  await client.query("ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT ''");
  await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'");
  await client.query("ALTER TABLE businesses ALTER COLUMN account_status SET DEFAULT 'pending'");
  await addConstraintIfMissing(client, "businesses", "businesses_account_status_check", "CHECK (account_status IN ('pending', 'active', 'suspended'))");
  await seedPlatformSettings(client);
  await seedSubscriptionPlans(client);
  await backfillSubscriptions(client);
  await seedSuperAdmin(client);
  await client.query("COMMIT");
  console.log("Database schema is ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}