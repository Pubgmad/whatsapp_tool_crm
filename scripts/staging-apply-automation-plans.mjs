#!/usr/bin/env node
/**
 * Staging-only: seed Free/Pro/Custom catalogue and hide legacy visible tiers.
 * Never overwrites Super Admin price edits for existing free/pro/custom rows beyond visibility.
 * Refuses non-staging DATABASE_URL.
 */
import nextEnv from '@next/env';
import { enterSystemContext, query, transaction } from '../lib/db.js';
import {
  builtInSubscriptionPlans,
  ensureDefaultSubscriptionPlans,
  DEFAULT_PLANS_VERSION
} from '../lib/default-plans.js';

nextEnv.loadEnvConfig(process.cwd());
const raw = process.env.DATABASE_URL || '';
const db = new URL(raw.includes('://') ? raw : `postgresql://${raw}`).pathname.replace(/^\//, '');
if (!/staging/i.test(db)) {
  console.error('Refusing non-staging database');
  process.exit(2);
}

enterSystemContext();
const seed = await transaction(async (client) => ensureDefaultSubscriptionPlans(client));
const byCode = Object.fromEntries(builtInSubscriptionPlans().map((plan) => [plan.code, plan]));
const legacy = await query(
  `UPDATE subscription_plans
      SET visible = FALSE,
          is_popular = FALSE,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('commercial_status','archived','catalogue_version',$1),
          updated_at = NOW()
    WHERE code = ANY($2::text[])
    RETURNING code`,
  [DEFAULT_PLANS_VERSION, ['starter', 'growth', 'professional', 'enterprise']]
);

const primaryCodes = ['free', 'pro', 'custom'];
for (const code of primaryCodes) {
  const plan = byCode[code];
  if (!plan) continue;
  await query(
    `UPDATE subscription_plans
        SET name = $2,
            description = $3,
            monthly_price_cents = $4,
            yearly_price_cents = $5,
            trial_days = $6,
            contact_limit = $7,
            campaign_limit = $8,
            user_limit = $9,
            automation_flow_limit = $10,
            monthly_message_limit = $11,
            whatsapp_conversation_limit = $12,
            features = $13::jsonb,
            display_order = $14,
            visible = TRUE,
            is_active = TRUE,
            is_popular = $15,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('commercial_status','published','catalogue_version',$16),
            updated_at = NOW()
      WHERE code = $1`,
    [
      code,
      plan.name,
      plan.description,
      plan.monthly_price_cents,
      plan.yearly_price_cents,
      plan.trial_days,
      plan.contact_limit,
      plan.campaign_limit,
      plan.user_limit,
      plan.automation_flow_limit,
      plan.monthly_message_limit,
      plan.whatsapp_conversation_limit,
      JSON.stringify(plan.features),
      plan.display_order,
      Boolean(plan.is_popular),
      DEFAULT_PLANS_VERSION
    ]
  );
}

const primary = await query(
  `SELECT code, name, monthly_price_cents, contact_limit, automation_flow_limit, visible, is_popular
     FROM subscription_plans
    WHERE code = ANY($1::text[])
    ORDER BY display_order`,
  [primaryCodes]
);

console.log(JSON.stringify({
  ok: true,
  database: db,
  version: DEFAULT_PLANS_VERSION,
  seed,
  legacyHidden: legacy.rows.map((row) => row.code),
  primaryVisible: primary.rows.map((row) => ({
    code: row.code,
    name: row.name,
    monthlyPriceCents: row.monthly_price_cents,
    contactLimit: row.contact_limit,
    automationFlowLimit: row.automation_flow_limit,
    visible: row.visible
  }))
}, null, 2));
