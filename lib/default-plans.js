/**
 * Versioned default subscription catalogue.
 * Free Forever is the only auto-published commercial default (₹0).
 * Paid tiers are seeded as invisible drafts for Super Admin to price and publish.
 * Competitor (AiSensy) list prices are research notes only — never copied as live MathStrat charges.
 *
 * `features` may mix:
 * - entitlement keys matching WORKSPACE_FEATURES (server gating via planAllowsFeature)
 * - human-readable marketing bullets (ignored by entitlement checks; shown on pricing)
 */

export const DEFAULT_PLANS_VERSION = 'mathstrat-default-plans-v2';

/** Prefer this code when DEFAULT_SUBSCRIPTION_PLAN_CODE is unset. */
export const DEFAULT_FREE_PLAN_CODE = 'free';

/**
 * Proposed commercial reference (INR / month) — Super Admin must set and publish.
 * Kept as documentation only; seeded monthly_price_cents stay 0 until approved.
 */
export const PROPOSED_PLAN_PRICES_INR = Object.freeze({
  free: 0,
  starter: 999,
  growth: 2499,
  professional: 5999,
  enterprise: null
});

/**
 * Built-in plans inserted by db-init when SUBSCRIPTION_PLANS_JSON is empty
 * (and Free Forever is always ensured).
 */
export function builtInSubscriptionPlans() {
  return [
    {
      code: DEFAULT_FREE_PLAN_CODE,
      name: 'Free Forever',
      description: 'Entry-level WhatsApp CRM access with no platform subscription fee. WhatsApp messaging charges from Meta remain separate.',
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
        'Templates and approved message tools',
        'Limited automation flows',
        'Basic CTWA access where Meta supports it',
        'No paid broadcasting campaigns',
        'Upgrade anytime for growth features'
      ],
      display_order: 10,
      visible: true,
      is_active: true
    },
    {
      code: 'starter',
      name: 'Starter',
      description: 'Draft paid tier for small teams — set commercial rates in Super Admin before publishing. Proposed reference ₹999/mo (not live).',
      currency: 'INR',
      monthly_price_cents: 0,
      yearly_price_cents: 0,
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
        'Additional team seats',
        'Expanded contact organization',
        'Basic operational reporting',
        'Limited broadcasting'
      ],
      display_order: 20,
      visible: false,
      is_active: true
    },
    {
      code: 'growth',
      name: 'Growth',
      description: 'Draft paid tier for broadcasting and growth workflows — set commercial rates in Super Admin before publishing. Proposed reference ₹2,499/mo (not live).',
      currency: 'INR',
      monthly_price_cents: 0,
      yearly_price_cents: 0,
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
      is_active: true
    },
    {
      code: 'professional',
      name: 'Professional',
      description: 'Draft paid tier for advanced automation and analytics — set commercial rates in Super Admin before publishing. Proposed reference ₹5,999/mo (not live).',
      currency: 'INR',
      monthly_price_cents: 0,
      yearly_price_cents: 0,
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
      is_active: true
    },
    {
      code: 'enterprise',
      name: 'Enterprise',
      description: 'Custom commercial terms — contact sales. Draft catalogue entry for Super Admin.',
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
        'inbox', 'templates', 'segments', 'whatsapp_flows', 'entry_points', 'ads',
        'calling', 'commerce', 'conversions', 'automation', 'campaigns', 'marketing_messages',
        'connectors', 'checkout_recovery', 'ai_agent', 'ai_auto_reply', 'dialogflow_bot',
        'webviews', 'crm_sync', 'whatsapp_groups',
        'Custom limits and governance',
        'Security review',
        'Dedicated onboarding',
        'Custom integrations'
      ],
      display_order: 50,
      visible: false,
      is_active: true
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
  const free = isFreeForeverPlan(plan)
    || (Number(plan.trial_days || 0) <= 0 && Number(plan.monthly_price_cents || 0) <= 0);
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
