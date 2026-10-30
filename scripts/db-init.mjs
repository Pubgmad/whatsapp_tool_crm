import crypto from "node:crypto";
import fs from "node:fs/promises";
import process from "node:process";
import nextEnv from "@next/env";
import pg from "pg";
import { seedPlatformSettings } from "../lib/platform.js";
import { DEFAULT_PRIVACY_POLICY } from "../lib/privacy-policy.js";
import { databaseSslConfig } from "../lib/db.js";
import { builtInSubscriptionPlans, DEFAULT_FREE_PLAN_CODE, ensureDefaultSubscriptionPlans } from "../lib/default-plans.js";
import { persistSanitizedPublicSiteDocuments } from "../lib/customer-facing-copy.js";
import { ensureMetaReviewerWorkspaceAccess } from "../lib/reviewer-access.js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Example: postgresql://postgres:password@localhost:5432/whatsapp_crm");
  process.exit(1);
}

const schema = (await fs.readFile(new URL("../db/schema.sql", import.meta.url), "utf8")).replace(/^\uFEFF/, "");
const pool = new Pool({
  connectionString: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL,
  ssl: databaseSslConfig()
});

function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(value), salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function clean(value) {
  return String(value || "").trim();
}

/** Username from DATABASE_URL — the runtime app role that needs table grants after migrations. */
function databaseUrlRole(connectionString = process.env.DATABASE_URL) {
  const raw = clean(connectionString);
  if (!raw) return '';
  try {
    const withProtocol = raw.includes('://') ? raw : `postgresql://${raw}`;
    return decodeURIComponent(new URL(withProtocol).username || '').trim();
  } catch {
    const match = raw.match(/^postgres(?:ql)?:\/\/([^:/?#@]+):/i);
    return match ? decodeURIComponent(match[1]).trim() : '';
  }
}

async function grantRuntimeAppRole(client) {
  const appRole = databaseUrlRole(process.env.DATABASE_URL);
  const migrationRole = databaseUrlRole(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL);
  if (!appRole) {
    console.warn('DATABASE_URL username missing; skipped app-role GRANTs.');
    return;
  }
  if (appRole === migrationRole && !clean(process.env.DATABASE_MIGRATION_URL)) {
    // Same role owns objects — privileges already apply. Still grant for safety on shared schemas.
  }
  // Quote identifier safely; only allow simple Postgres role names.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(appRole)) {
    console.warn(`DATABASE_URL role "${appRole}" is not a plain identifier; skipped GRANTs.`);
    return;
  }
  await client.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appRole}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appRole}`
  );
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${appRole}`
  );
  console.log(`Granted public schema DML to runtime role ${appRole}.`);
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
  if (!raw) return builtInSubscriptionPlans();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not array");
    // Always ensure Free Forever exists even when custom JSON is provided.
    const codes = new Set(parsed.map((plan) => clean(plan.code).toLowerCase()).filter(Boolean));
    const merged = [...parsed];
    for (const plan of builtInSubscriptionPlans()) {
      if (!codes.has(plan.code)) merged.push(plan);
    }
    return merged;
  } catch {
    throw new Error("SUBSCRIPTION_PLANS_JSON must be a valid JSON array.");
  }
}

async function addConstraintIfMissing(client, table, name, expression) {
  const existing = await client.query("SELECT 1 FROM pg_constraint WHERE conname = $1", [name]);
  if (!existing.rows[0]) await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} ${expression}`);
}

async function seedSubscriptionPlans(client) {
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_popular BOOLEAN NOT NULL DEFAULT FALSE");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb");
  await ensureDefaultSubscriptionPlans(client, parsePlans());
}

async function backfillSubscriptions(client) {
  const defaultCode = clean(process.env.DEFAULT_SUBSCRIPTION_PLAN_CODE || DEFAULT_FREE_PLAN_CODE).toLowerCase();
  const plan = (
    await client.query(
      `SELECT id, code, trial_days, monthly_price_cents, yearly_price_cents
         FROM subscription_plans
        WHERE code = $1 AND is_active = TRUE AND visible = TRUE
        LIMIT 1`,
      [defaultCode]
    )
  ).rows[0]
    || (
      await client.query(
        `SELECT id, code, trial_days, monthly_price_cents, yearly_price_cents
           FROM subscription_plans
          WHERE code = $1 AND is_active = TRUE AND visible = TRUE
          LIMIT 1`,
        [DEFAULT_FREE_PLAN_CODE]
      )
    ).rows[0]
    || null;

  const isFree = plan && (plan.code === DEFAULT_FREE_PLAN_CODE || (Number(plan.monthly_price_cents || 0) <= 0 && Number(plan.trial_days || 0) <= 0));
  const status = !plan ? 'pending' : isFree ? 'active' : 'trialing';
  const trialDays = isFree ? 0 : Number(plan?.trial_days || 0);

  await client.query(
    `INSERT INTO business_subscriptions (id, business_id, plan_id, status, payment_status, starts_at, trial_ends_at, current_period_start, current_period_end, renews_at)
     SELECT 'sub_' || substr(md5(b.id || clock_timestamp()::text), 1, 16),
            b.id,
            $1,
            $2,
            'none',
            NOW(),
            CASE WHEN $2 = 'trialing' THEN NOW() + ($3 || ' days')::interval ELSE NULL END,
            NOW(),
            CASE WHEN $2 = 'active' AND $4::boolean THEN NULL ELSE NOW() + INTERVAL '1 month' END,
            CASE WHEN $2 = 'active' AND $4::boolean THEN NULL ELSE NOW() + INTERVAL '1 month' END
     FROM businesses b
     WHERE b.review_access = FALSE
       AND NOT EXISTS (SELECT 1 FROM business_subscriptions bs WHERE bs.business_id = b.id)`,
    [plan?.id || null, status, String(trialDays), Boolean(isFree)]
  );

  // Heal workspaces that never received a plan (missing Free Forever seed).
  if (plan?.id && isFree) {
    await client.query(
      `UPDATE business_subscriptions bs
          SET plan_id = $1,
              status = 'active',
              trial_ends_at = NULL,
              current_period_end = NULL,
              renews_at = NULL,
              updated_at = NOW()
        WHERE bs.plan_id IS NULL
          AND bs.status IN ('pending', 'incomplete', 'unpaid', 'trialing')`,
      [plan.id]
    );
  }
}

async function seedSuperAdmin(client) {
  const email = clean(process.env.SUPER_ADMIN_EMAIL).toLowerCase();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "");
  if (!email || !password) return;
  if (password.length < 12) throw new Error("SUPER_ADMIN_PASSWORD must be at least 12 characters.");

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
  await client.query('SELECT set_config(\'app.system_access\',\'true\',true)');
  const assetTables = (await client.query(
    "SELECT to_regclass('public.businesses') IS NOT NULL AS businesses, to_regclass('public.whatsapp_accounts') IS NOT NULL AS accounts, to_regclass('public.whatsapp_phone_numbers') IS NOT NULL AS phones"
  )).rows[0];
  if (assetTables.businesses && assetTables.accounts && assetTables.phones) {
    for (const [legacyColumn, table, assetColumn] of [
      ['waba_id', 'whatsapp_accounts', 'waba_id'],
      ['phone_number_id', 'whatsapp_phone_numbers', 'phone_number_id']
    ]) {
      const conflict = await client.query(
        `SELECT asset_id FROM (
           SELECT NULLIF(${legacyColumn},'') AS asset_id,id AS business_id FROM businesses
           UNION ALL SELECT ${assetColumn} AS asset_id,business_id FROM ${table}
         ) ownership WHERE asset_id IS NOT NULL
         GROUP BY asset_id HAVING COUNT(DISTINCT business_id)>1 LIMIT 1`
      );
      if (conflict.rows[0]) {
        throw new Error(`A WhatsApp ${assetColumn} is linked to multiple companies. Resolve asset ownership before running db:init.`);
      }
    }
  }
  await client.query("DO $$ BEGIN IF to_regclass('public.businesses') IS NOT NULL THEN ALTER TABLE businesses ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'; END IF; END $$;");
  await client.query(schema);
  await client.query(await fs.readFile(new URL('../db/whatsapp-commerce.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-template-parameters.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-conversions.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/meta-credit-operations.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/razorpay.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-calling.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-native-payments.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-ads.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/campaign-controls.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/coexistence-recovery.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-entry-points.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-flow-designs.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-call-followups.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/workspace-integrations.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-experiences.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/commerce-automation.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/engagement-audiences.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-retargeting.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/production-p1-wave.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/production-p2-wave.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/production-p3-wave.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/campaign-drip-delivery-gate.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-widgets.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/support-policy.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/click-tracking.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/core-crm-consent.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/automation-advanced-nodes.sql', import.meta.url), 'utf8'));
  // flow-runtime + webviews before automation-flows-production (ALTERs whatsapp_webviews)
  await client.query(await fs.readFile(new URL('../db/flow-runtime.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-webviews.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/automation-flows-production.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/provider-connectors.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/commerce-payments-production.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/ads-growth-production.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/meta-review-hardening.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/meta-integration-defects.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/ad-credits.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/external-availability.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/crm-connectors.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/crm-production-gaps.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/whatsapp-credential-reconcile.sql', import.meta.url), 'utf8'));
  // product-completion-wave ALTERs crm_connections — must run after crm-connectors CREATE
  await client.query(await fs.readFile(new URL('../db/product-completion-wave.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/ai-integrations-production.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/ai-production-closures.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/ai-module-complete.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/other-features-production.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/production-parity-extensions.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/feature-completion-wave.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/smb-competitive-wave.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/meta-webhook-queue.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/public-site.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/google-login-oauth.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/inbox-contact-360.sql', import.meta.url), 'utf8'));
  await client.query(await fs.readFile(new URL('../db/campaign-source-taxonomy.sql', import.meta.url), 'utf8'));
  await client.query(
    `INSERT INTO message_usage_events (id,business_id,contact_ref,meta_message_id,source,sent_at)
     SELECT 'mue_' || md5(m.meta_message_id),c.business_id,c.contact_id,m.meta_message_id,
            CASE WHEN m.campaign_recipient_id IS NULL THEN 'conversation' ELSE 'campaign' END,m.at
     FROM messages m JOIN conversations c ON c.id=m.conversation_id
     WHERE m.direction='outgoing' AND COALESCE(m.meta_message_id,'')<>''
     ON CONFLICT (meta_message_id) DO NOTHING`
  );
  await client.query(
    `INSERT INTO message_usage_events (id,business_id,contact_ref,meta_message_id,source,sent_at)
     SELECT 'mue_' || md5(cr.meta_message_id),k.business_id,cr.contact_id,cr.meta_message_id,
            'campaign',COALESCE(cr.sent_at,k.created_at)
     FROM campaign_recipients cr JOIN campaigns k ON k.id=cr.campaign_id
     WHERE cr.status IN ('sent','delivered','read') AND COALESCE(cr.meta_message_id,'')<>''
     ON CONFLICT (meta_message_id) DO NOTHING`
  );
  await client.query("CREATE TABLE IF NOT EXISTS platform_audit_logs (id TEXT PRIMARY KEY, super_admin_id TEXT REFERENCES super_admins(id) ON DELETE SET NULL, action TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
  await client.query("CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_at ON platform_audit_logs(at DESC)");
  await client.query("ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS automation_flow_limit INTEGER");
  await client.query("ALTER TABLE subscription_plans ALTER COLUMN currency DROP DEFAULT");
  await client.query("ALTER TABLE billing_events ALTER COLUMN currency DROP DEFAULT");
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
  await client.query("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
  await client.query("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS automation_flow_id TEXT");
  await client.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_user_id TEXT");
  await client.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS automation_paused BOOLEAN NOT NULL DEFAULT FALSE");
  await client.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT NOT NULL DEFAULT ''");
  await client.query("ALTER TABLE whatsapp_phone_numbers ADD COLUMN IF NOT EXISTS commerce_settings JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE automation_sessions ADD COLUMN IF NOT EXISTS assigned_user_id TEXT");
  await client.query("ALTER TABLE automation_sessions ADD COLUMN IF NOT EXISTS campaign_id TEXT");
  await client.query("CREATE INDEX IF NOT EXISTS idx_campaigns_automation_flow ON campaigns(automation_flow_id)");
  await client.query("CREATE INDEX IF NOT EXISTS idx_conversations_assigned_user ON conversations(assigned_user_id)");
  await addConstraintIfMissing(client, "campaigns", "campaigns_automation_flow_id_fkey", "FOREIGN KEY (automation_flow_id) REFERENCES automation_flows(id) ON DELETE SET NULL");
  await addConstraintIfMissing(client, "conversations", "conversations_assigned_user_id_fkey", "FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL");
  await addConstraintIfMissing(client, "automation_sessions", "automation_sessions_assigned_user_id_fkey", "FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL");
  await addConstraintIfMissing(client, "automation_sessions", "automation_sessions_campaign_id_fkey", "FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL");
  await client.query("ALTER TABLE templates ADD COLUMN IF NOT EXISTS meta_template_name TEXT DEFAULT ''");
  await client.query("ALTER TABLE templates ADD COLUMN IF NOT EXISTS component_schema JSONB NOT NULL DEFAULT '{}'::jsonb");
  await client.query("ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS error_message TEXT DEFAULT ''");
  await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'");
  await client.query("ALTER TABLE businesses ADD COLUMN IF NOT EXISTS review_access BOOLEAN NOT NULL DEFAULT FALSE");
  await client.query("ALTER TABLE businesses ALTER COLUMN account_status SET DEFAULT 'pending'");
  await addConstraintIfMissing(client, "businesses", "businesses_account_status_check", "CHECK (account_status IN ('pending', 'active', 'suspended'))");
  await client.query(
    `INSERT INTO whatsapp_accounts (id, business_id, waba_id, onboarding_method, access_token_encrypted, token_expires_at, webhook_subscribed, is_default, status, metadata, last_synced_at)
     SELECT 'waa_' || substr(md5(b.id || b.waba_id), 1, 16), b.id, b.waba_id, b.onboarding_method,
            b.access_token_encrypted, b.meta_token_expires_at, b.webhook_subscribed, TRUE,
            CASE WHEN b.status = 'Connected' THEN 'connected' ELSE 'attention' END,
            b.meta_connection_metadata, b.updated_at
     FROM businesses b
     WHERE NULLIF(b.waba_id, '') IS NOT NULL
     ON CONFLICT (business_id, waba_id) DO UPDATE SET
       access_token_encrypted = EXCLUDED.access_token_encrypted,
       token_expires_at = EXCLUDED.token_expires_at,
       webhook_subscribed = EXCLUDED.webhook_subscribed,
       updated_at = NOW()`
  );
  await client.query(
    `INSERT INTO whatsapp_phone_numbers (id, business_id, whatsapp_account_id, phone_number_id, display_phone_number, verified_name, quality_rating, status, is_default, metadata, last_synced_at)
     SELECT 'wap_' || substr(md5(b.id || b.phone_number_id), 1, 16), b.id, wa.id, b.phone_number_id, b.whatsapp_number,
            COALESCE(b.meta_connection_metadata->>'verifiedName', ''), COALESCE(b.meta_connection_metadata->>'qualityRating', ''),
            COALESCE(b.meta_connection_metadata->>'phoneStatus', ''), TRUE, b.meta_connection_metadata, b.updated_at
     FROM businesses b JOIN whatsapp_accounts wa ON wa.business_id = b.id AND wa.waba_id = b.waba_id
     WHERE NULLIF(b.phone_number_id, '') IS NOT NULL
     ON CONFLICT (business_id, phone_number_id) DO UPDATE SET
       display_phone_number = EXCLUDED.display_phone_number,
       verified_name = EXCLUDED.verified_name,
       quality_rating = EXCLUDED.quality_rating,
       status = EXCLUDED.status,
       updated_at = NOW()`
  );
  await client.query(await fs.readFile(new URL('../db/template-ownership.sql', import.meta.url), 'utf8'));
  await seedPlatformSettings(client);
  // Migrate legacy marketing CTA copy only when it still matches the old product default.
  await client.query(
    `UPDATE platform_settings
        SET value = $1::jsonb, updated_at = NOW()
      WHERE key = 'public_signup_label'
        AND value = $2::jsonb`,
    [JSON.stringify('Get started'), JSON.stringify('Create workspace')]
  );
  const privacySettings = (await client.query("SELECT key,value FROM platform_settings WHERE key IN ('privacy_intro','privacy_last_updated')")).rows;
  const privacyValues = Object.fromEntries(privacySettings.map((row) => [row.key, row.value]));
  const initialPolicy = { ...DEFAULT_PRIVACY_POLICY, intro: String(privacyValues.privacy_intro || DEFAULT_PRIVACY_POLICY.intro) };
  await client.query(
    "INSERT INTO privacy_policy_versions (id,version,document,effective_date) VALUES ('privacy_initial',1,$1::jsonb,$2) ON CONFLICT (version) DO NOTHING",
    [JSON.stringify(initialPolicy), String(privacyValues.privacy_last_updated || new Date().toISOString().slice(0, 10))]
  );
  await client.query(
    "INSERT INTO privacy_policy_drafts (id,document) SELECT 'current',document FROM privacy_policy_versions ORDER BY version DESC LIMIT 1 ON CONFLICT (id) DO NOTHING"
  );
  await seedSubscriptionPlans(client);
  await client.query(await fs.readFile(new URL('../db/publish-paid-plans.sql', import.meta.url), 'utf8'));
  await backfillSubscriptions(client);
  await seedSuperAdmin(client);
  const reviewerHeal = await ensureMetaReviewerWorkspaceAccess(client);
  if (reviewerHeal.updated) {
    console.log(`Meta App Review workspace: billing bypass enabled (${reviewerHeal.updated} workspace(s)).`);
  }
  // Persist known customer-facing jargon scrub into draft + published CMS (no overwrite of unrelated edits).
  const cmsSanitize = await persistSanitizedPublicSiteDocuments(client);
  if (cmsSanitize.updated) {
    console.log(
      `Public site CMS sanitized (draft=${cmsSanitize.draftChanged}, published=${cmsSanitize.publishedChanged}).`
    );
  }
  // Migration role (DATABASE_MIGRATION_URL) often owns tables; GRANT TO CURRENT_USER in SQL
  // files never privileges the runtime DATABASE_URL role — fix that here.
  try {
    await grantRuntimeAppRole(client);
  } catch (grantError) {
    console.warn(
      `App-role GRANTs failed (${grantError.message}). Run as a superuser/migration owner, or GRANT manually to the DATABASE_URL role.`
    );
  }
  await client.query("COMMIT");
  console.log("Database schema is ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
