/**
 * MathStrat public pricing architecture (draft defaults).
 * Competitor research (AiSensy) informs structure only — never publish their rates as ours.
 * Commercial amounts live in subscription_plans and must be Super Admin–approved before visibility.
 */

export const PRICING_ARCHITECTURE = Object.freeze({
  schemaVersion: 'mathstrat-pricing-draft-1',
  status: 'draft',
  currencyDefault: 'INR',
  competitorNote:
    'AiSensy separates platform subscription from WhatsApp conversation credits and AI add-ons. Their list prices are competitor research only.',
  chargeLayers: Object.freeze([
    {
      id: 'platform',
      title: 'MathStrat platform subscription',
      description: 'CRM seats, inbox, broadcasts, automation caps, and support tier configured on the plan.'
    },
    {
      id: 'messaging',
      title: 'WhatsApp messaging charges',
      description: 'Meta category and destination rates (marketing, utility, authentication, service). Billed separately via conversation/message credits — not bundled into the platform sticker price.'
    },
    {
      id: 'ai',
      title: 'Optional AI usage',
      description: 'Included AI units on the plan when configured; overages as Super Admin–defined add-ons.'
    },
    {
      id: 'seats',
      title: 'Additional agent seats',
      description: 'Seats beyond the plan’s included agent limit, when sellable add-ons exist.'
    },
    {
      id: 'tax',
      title: 'Applicable taxes',
      description: 'GST or other taxes applied at checkout according to billing configuration.'
    }
  ]),
  draftPlanCodes: Object.freeze(['trial', 'starter', 'growth', 'advanced', 'enterprise']),
  faq: Object.freeze([
    {
      q: 'Is the listed price the full cost of WhatsApp messaging?',
      a: 'No. The public plan price is the MathStrat platform subscription. WhatsApp delivery follows Meta’s rates by message category and destination country, and is tracked separately.'
    },
    {
      q: 'Why don’t you show fixed Meta rates on this page?',
      a: 'Meta pricing changes by country and category. Super Admin can publish disclosures and wallet top-ups; we do not hardcode a competitor’s pass-through schedule as MathStrat commercial terms.'
    },
    {
      q: 'Can Super Admin change plans without a code deploy?',
      a: 'Yes. Plan names, prices, entitlements, visibility, and features are managed in the Super Admin console. Unpublished or zero-priced drafts stay clearly labeled until approved.'
    },
    {
      q: 'How do upgrades and downgrades work?',
      a: 'When billing is connected, plan changes follow the existing subscription flow. Entitlements apply after the active subscription updates — we do not invent silent unlimited usage.'
    },
    {
      q: 'What about Enterprise?',
      a: 'Enterprise is custom: seats, limits, security reviews, and commercial terms are agreed with your team. Contact us rather than selecting a self-serve sticker price.'
    }
  ])
});
