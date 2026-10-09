/**
 * Production boundaries we document in UI and parity — not marketing claims.
 */

export const HONEST_PRODUCT_LIMITS = Object.freeze([
  {
    id: 'whatsapp_groups',
    title: 'WhatsApp Groups',
    boundary:
      'Only what Meta’s Cloud API exposes for your WABA. Groups module sync, groups-inbox list/mark-read/send, and outbound group text are supported; the main shared inbox remains 1:1-first and does not treat groups as CRM contacts.',
    operatorActions: ['Enable feature_whatsapp_groups in Super Admin', 'Sync on Settings → Groups', 'Use Groups inbox for group threads; use Inbox for 1:1 customers']
  },
  {
    id: 'meta_billing_visibility',
    title: 'Meta billing visibility',
    boundary:
      'Extended-credit and allocation probes surfaced in Meta capabilities — not a full Ads Manager or invoice console. Availability depends on Meta credit-line access, scopes, and platform billing credentials.',
    operatorActions: ['Configure platform billing credential + Business Portfolio ID', 'Refresh Meta Setup capabilities after WABA connect']
  },
  {
    id: 'inbox_contact_360',
    title: 'Inbox Contact 360',
    boundary:
      'Combined inbox profile, consent, tags, attributes, and a paginated activity timeline from CRM-stored events — not every AiSensy chat-profile field or undocumented Meta signal.',
    operatorActions: ['Open a conversation in Inbox', 'Use Contact 360 for tags and timeline; export journey report for workspace-wide analytics']
  },
  {
    id: 'audience_bulk_tags',
    title: 'Audience bulk tags',
    boundary:
      'Manager-only segment bulk add/remove tag jobs via API (idempotent, audited). There is no audience-composer wizard UI yet; large segments run as a single job transaction.',
    operatorActions: ['POST /api/segments/{id}/bulk-tags with Idempotency-Key', 'Poll /api/audience-tag-jobs/{id} or retry on failure']
  },
  {
    id: 'campaign_drip',
    title: 'Campaign drip sequences',
    boundary:
      'Multi-step approved-template drips enrolled from saved segments with worker scheduling — not a separate visual journey canvas or AiSensy drip preset library.',
    operatorActions: ['Campaigns → Drip sequences', 'Attach an active segment and approved templates per step']
  },
  {
    id: 'integration_marketplace',
    title: 'Integration marketplace',
    boundary:
      'Operator-controlled connector catalog plus Zapier/Make/n8n webhook recipes. Not a hosted app store with 2000+ OAuth apps.',
    operatorActions: ['Edit integration_catalog in platform settings', 'Issue workspace API keys and signed webhooks']
  },
  {
    id: 'mm_lite_optimizer',
    title: 'MM Lite / Marketing Messages',
    boundary:
      'TTL, benchmarks, and creative optimization are owned by Meta. This CRM documents eligibility, send path, and gates marketing sends when not ONBOARDED.',
    operatorActions: ['Refresh entitlements on Capabilities', 'Configure campaigns only when MM API status is ONBOARDED']
  },
  {
    id: 'ai_safety_eval',
    title: 'AI safety & evaluation',
    boundary:
      'Event log, injection heuristics, caps, and lightweight reply samples — not a full red-team or model-eval product.',
    operatorActions: ['Review Team → AI safety panel', 'Set platform AI caps in Super Admin features']
  },
  {
    id: 'slo_certification',
    title: 'Load-test & SLO certification',
    boundary:
      'Queue metrics, send-event thresholds, and VPS attestation recording — you still run real volume tests on your infrastructure.',
    operatorActions: ['node scripts/load-test-slo.mjs after volume test', 'Record run in Super Admin SLO panel']
  },
  {
    id: 'a11y_certification',
    title: 'Accessibility E2E',
    boundary:
      'Playwright label/landmark checks across desktop and mobile projects — not WCAG audit certification or VPAT.',
    operatorActions: ['npm run test:e2e', 'node scripts/record-a11y-e2e.mjs after green CI']
  }
]);

export function honestLimitById(limitId) {
  return HONEST_PRODUCT_LIMITS.find((item) => item.id === limitId) || null;
}

export function honestLimitsPayload() {
  return {
    limits: HONEST_PRODUCT_LIMITS,
    generatedAt: new Date().toISOString()
  };
}
