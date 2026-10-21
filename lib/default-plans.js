/**
 * Versioned default subscription catalogue.
 * Free Forever is the only auto-published commercial default (₹0, visible).
 * Paid tiers are seeded as hidden drafts with proposed list prices for Super Admin
 * to review, edit, and publish. Publishing does not itself charge customers —
 * Razorpay checkout + webhook verification still required for paid activation.
 *
 * Competitor (AiSensy) architecture informs structure only — never copied as live MathStrat charges.
 *
 * `features` may mix:
 * - entitlement keys matching WORKSPACE_FEATURES (server gating via planAllowsFeature)
 * - human-readable marketing bullets (ignored by entitlement checks; shown on pricing)
 */

import crypto from 'node:crypto';

export const DEFAULT_PLANS_VERSION = 'mathstrat-default-plans-v3';

/** Prefer this code when DEFAULT_SUBSCRIPTION_PLAN_CODE is unset. */
export const DEFAULT_FREE_PLAN_CODE = 'free';

/**
 * Proposed commercial reference (INR / month) — editable in Super Admin.
 * Seeded into monthly_price_cents for draft paid plans (visible=false) so admins
 * see real proposals. Public Pricing and checkout only use visible plans.
 */
export const PROPOSED_PLAN_PRICES_INR = Object.freeze({
  free: 0,
  starter: 999,
  growth: 2499,
  professional: 5999,
  enterprise: null
});

function inrToCents(rupees) {
  if (rupees == null || !Number.isFinite(Number(rupees))) return 0;
  return Math.round(Number(rupees) * 100);
}

/** ~10% annual discount vs 12× monthly (draft proposal only). */
function yearlyFromMonthlyInr(monthlyInr) {
  if (monthlyInr == null || monthlyInr <= 0) return 0;
  return inrToCents(Math.round(monthlyInr * 12 * 0.9));
}

/**
 * Built-in plans inserted by db-init / ensureDefaultSubscriptionPlans
 * when SUBSCRIPTION_PLANS_JSON is empty (and Free Forever is always ensured).
 */
export function builtInSubscriptionPlans() {
  return [
    {
      code: DEFAULT_FREE_PLAN_CODE,
      name: 'Free Forever',
      description:
        'Get started with WhatsApp CRM at no platform subscription fee. Meta WhatsApp messaging charges remain separate.',
      currency: 'INR',
      monthly_price_cents: 0,
      yearly_price_cents: 0,
      trial_days: 0,
      contact_limit: 500,
      campaign_limit: 0,
      user_limit: 2,
      automation_flow_limit: 3,
      monthly_message_limit: 500,
      whatsapp_conversation_limit: 500,
      features: [
        'inbox',
        'templates',
        'segments',
        'automation',
        'ads',
        'entry_points',
        'Shared inbox (2 seats)',
        'Contacts and basic segments',
        'Message templates',
        'Limited automation flows',
        'Basic CTWA entry points where Meta supports them',
        'No paid broadcasting campaigns',
        'Upgrade anytime for growth features'
      ],
      display_order: 10,
      visible: true,
      is_active: true,
      is_popular: false,
      commercial_status: 'published'
    },
    {
      code: 'starter',
      name: 'Starter',
      description:
        'For small teams that need more seats and light broadcasting. Draft proposal — set final rates and publish in Super Admin before customers can buy.',
      currency: 'INR',
      monthly_price_cents: inrToCents(PROPOSED_PLAN_PRICES_INR.starter),
      yearly_price_cents: yearlyFromMonthlyInr(PROPOSED_PLAN_PRICES_INR.starter),
      trial_days: 14,
      contact_limit: 5000,
      campaign_limit: 5,
      user_limit: 5,
      automation_flow_limit: 10,
      monthly_message_limit: 5000,
      whatsapp_conversation_limit: 5000,
      features: [
        'inbox',
        'templates',
        'segments',
        'automation',
        'ads',
        'entry_points',
        'calling',
        'campaigns',
        'Everything in Free Forever',
        'Additional team seats (up to 5)',
        'Expanded contact organization',
        'Limited broadcasting campaigns',
        'WhatsApp calling when Meta enables it'
      ],
      display_order: 20,
      visible: false,
      is_active: true,
      is_popular: false,
      commercial_status: 'draft'
    },
    {
      code: 'growth',
      name: 'Growth',
      description:
        'For teams running broadcasts, segments, and store connectors. Draft proposal — publish only after commercial approval.',
      currency: 'INR',
      monthly_price_cents: inrToCents(PROPOSED_PLAN_PRICES_INR.growth),
      yearly_price_cents: yearlyFromMonthlyInr(PROPOSED_PLAN_PRICES_INR.growth),
      trial_days: 14,
      contact_limit: 25000,
      campaign_limit: 50,
      user_limit: 15,
      automation_flow_limit: 50,
      monthly_message_limit: 25000,
      whatsapp_conversation_limit: 25000,
      features: [
        'inbox',
        'templates',
        'segments',
        'automation',
        'ads',
        'entry_points',
        'calling',
        'campaigns',
        'marketing_messages',
        'commerce',
        'conversions',
        'connectors',
        'Everything in Starter',
        'Broadcasting and campaign management',
        'Audience segmentation',
        'Campaign analytics',
        'Commerce and store connectors'
      ],
      display_order: 30,
      visible: false,
      is_active: true,
      is_popular: true,
      commercial_status: 'draft'
    },
    {
      code: 'professional',
      name: 'Professional',
      description:
        'For advanced automation, Flows, AI drafts, and CRM sync. Draft proposal — publish only after commercial approval.',
      currency: 'INR',
      monthly_price_cents: inrToCents(PROPOSED_PLAN_PRICES_INR.professional),
      yearly_price_cents: yearlyFromMonthlyInr(PROPOSED_PLAN_PRICES_INR.professional),
      trial_days: 14,
      contact_limit: 100000,
      campaign_limit: 200,
      user_limit: 40,
      automation_flow_limit: 200,
      monthly_message_limit: 100000,
      whatsapp_conversation_limit: 100000,
      features: [
        'inbox',
        'templates',
        'segments',
        'automation',
        'ads',
        'entry_points',
        'calling',
        'campaigns',
        'marketing_messages',
        'commerce',
        'conversions',
        'connectors',
        'whatsapp_flows',
        'webviews',
        'ai_agent',
        'crm_sync',
        'Everything in Growth',
        'Advanced automation and WhatsApp Flows',
        'AI assistant drafts (when configured)',
        'CRM sync and hosted pages',
        'Higher usage limits'
      ],
      display_order: 40,
      visible: false,
      is_active: true,
      is_popular: false,
      commercial_status: 'draft'
    },
    {
      code: 'enterprise',
      name: 'Enterprise',
      description:
        'Custom commercial terms, limits, and governance. Contact sales — no self-serve sticker price.',
      currency: 'INR',
      monthly_price_cents: 0,
      yearly_price_cents: 0,
      trial_days: 0,
      contact_limit: null,
      campaign_limit: null,
      user_limit: null,
      automation_flow_limit: null,
      monthly_message_limit: null,
      whatsapp_conversation_limit: null,
      features: [
        'inbox',
        'templates',
        'segments',
        'whatsapp_flows',
        'entry_points',
        'ads',
        'calling',
        'commerce',
        'conversions',
        'automation',
        'campaigns',
        'marketing_messages',
        'connectors',
        'checkout_recovery',
        'ai_agent',
        'ai_auto_reply',
        'dialogflow_bot',
        'webviews',
        'crm_sync',
        'whatsapp_groups',
        'Custom limits and governance',
        'Security review',
        'Dedicated onboarding',
        'Custom integrations',
        'Contact sales for pricing'
      ],
      display_order: 50,
      visible: false,
      is_active: true,
      is_popular: false,
      commercial_status: 'draft'
    }
  ];
}

export function isFreeForeverPlan(plan) {
  if (!plan) return false;
  const code = String(plan.code || '').trim().toLowerCase();
  const monthly = Number(plan.monthly_price_cents ?? plan.monthlyPriceCents ?? 0);
  const yearly = Number(plan.yearly_price_cents ?? plan.yearlyPriceCents ?? 0);
  if (code === DEFAULT_FREE_PLAN_CODE || code === 'free_forever') return monthly <= 0 && yearly <= 0;
  return false;
}

/**
 * Resolve plan row for new workspaces. Falls back to Free Forever when env code is unset.
 */
export async function lookupDefaultSubscriptionPlan(client) {
  const envCode = String(process.env.DEFAULT_SUBSCRIPTION_PLAN_CODE || '').trim().toLowerCase();
  const codes = envCode ? [envCode, DEFAULT_FREE_PLAN_CODE] : [DEFAULT_FREE_PLAN_CODE];
  for (const code of codes) {
    const result = await client.query(
      `SELECT id, code, trial_days, monthly_price_cents, yearly_price_cents
         FROM subscription_plans
        WHERE code = $1 AND is_active = TRUE AND visible = TRUE
        LIMIT 1`,
      [code]
    );
    if (result.rows[0]) return result.rows[0];
  }
  return null;
}

/**
 * Subscription insert fields for a newly provisioned business.
 * Free Forever → active (no trial expiry). Paid/trial → trialing when trial_days > 0.
 */
export function subscriptionFieldsForPlan(plan) {
  const oneMonth = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (!plan?.id) {
    return { planId: null, status: 'pending', trialEndsAt: null, periodEnd: oneMonth() };
  }
  const free =
    isFreeForeverPlan(plan) ||
    (Number(plan.trial_days || 0) <= 0 && Number(plan.monthly_price_cents || 0) <= 0);
  if (free) {
    return {
      planId: plan.id,
      status: 'active',
      trialEndsAt: null,
      // Free Forever does not expire for entitlement checks (null period end).
      periodEnd: null
    };
  }
  const trialDays = Number(plan.trial_days || 0);
  if (trialDays > 0) {
    return {
      planId: plan.id,
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
      periodEnd: oneMonth()
    };
  }
  return {
    planId: plan.id,
    status: 'active',
    trialEndsAt: null,
    periodEnd: oneMonth()
  };
}

function clean(value) {
  return String(value || '').trim();
}

function optionalNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

/**
 * Idempotent catalogue seed: insert missing plan codes only.
 * Never overwrites Super Admin edits (ON CONFLICT DO NOTHING on code).
 * Returns { inserted: string[], existing: string[] }.
 */
export async function ensureDefaultSubscriptionPlans(client, plans = builtInSubscriptionPlans()) {
  const inserted = [];
  const existing = [];
  for (const plan of plans) {
    const code = clean(plan.code).toLowerCase();
    const name = clean(plan.name);
    if (!code || !name) continue;
    const currency = clean(plan.currency || 'INR').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error(`Plan ${code} requires a three-letter currency code.`);
    }
    const monthlyPrice =
      optionalNumber(plan.monthlyPriceCents, plan.monthly_price_cents, plan.priceCents, plan.price_cents) || 0;
    const yearlyPrice = optionalNumber(plan.yearlyPriceCents, plan.yearly_price_cents) || 0;
    const metadata = {
      commercial_status: plan.commercial_status || (plan.visible === false ? 'draft' : 'published'),
      catalogue_version: DEFAULT_PLANS_VERSION,
      proposed_monthly_inr: PROPOSED_PLAN_PRICES_INR[code] ?? null
    };

    const result = await client.query(
      `INSERT INTO subscription_plans (
         id, code, name, description, billing_interval, price_cents,
         monthly_price_cents, yearly_price_cents, currency, trial_days,
         contact_limit, campaign_limit, user_limit, automation_flow_limit,
         monthly_message_limit, whatsapp_conversation_limit, features,
         display_order, visible, is_active, is_popular, metadata
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21,$22::jsonb
       )
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [
        `plan_${crypto.randomBytes(8).toString('hex')}`,
        code,
        name,
        clean(plan.description),
        clean(plan.billingInterval || plan.billing_interval || 'monthly'),
        monthlyPrice,
        monthlyPrice,
        yearlyPrice,
        currency,
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
        plan.isActive === false || plan.is_active === false ? false : true,
        Boolean(plan.is_popular || plan.isPopular),
        JSON.stringify(metadata)
      ]
    );
    if (result.rowCount) inserted.push(code);
    else existing.push(code);
  }
  return { inserted, existing, version: DEFAULT_PLANS_VERSION };
}
