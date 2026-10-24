/**
 * Production boundaries we document in UI and parity — not marketing claims.
 * `tenantSummary` is shown to ordinary workspace users; `boundary` + operatorActions stay for Advanced / Super Admin.
 */

export const HONEST_PRODUCT_LIMITS = Object.freeze([
  {
    id: 'whatsapp_groups',
    title: 'WhatsApp Groups',
    tenantSummary: 'Group messaging depends on Meta eligibility for your WhatsApp account.',
    boundary:
      'Only what Meta’s Cloud API exposes for your WABA. Groups module sync, groups-inbox list/mark-read/send, and outbound group text are supported; the main shared inbox remains 1:1-first and does not treat groups as CRM contacts.',
    operatorActions: ['Enable feature_whatsapp_groups in Super Admin', 'Sync on Settings → Groups', 'Use Groups inbox for group threads; use Inbox for 1:1 customers']
  },
  {
    id: 'meta_billing_visibility',
    title: 'Meta billing visibility',
    tenantSummary: 'Shows Meta credit-line status when available — not a full Ads billing console.',
    boundary:
      'Extended-credit and allocation probes surfaced in Meta capabilities — not a full Ads Manager or invoice console. Availability depends on Meta credit-line access, scopes, and platform billing credentials.',
    operatorActions: ['Configure platform billing credential + Business Portfolio ID', 'Refresh Meta Setup capabilities after WABA connect']
  },
  {
    id: 'inbox_contact_360',
    title: 'Inbox Contact 360',
    tenantSummary: 'Profile, consent, tags, and recent activity for the open conversation.',
    boundary:
      'Combined inbox profile, consent, tags, attributes, and a paginated activity timeline from CRM-stored events — not every third-party chat-profile field or undocumented Meta signal.',
    operatorActions: ['Open a conversation in Inbox', 'Use Contact 360 for tags and timeline; export journey report for workspace-wide analytics']
  },
  {
    id: 'audience_bulk_tags',
    title: 'Audience bulk tags',
    tenantSummary: 'Apply or remove tags across a saved segment in the background.',
    boundary:
      'Manager-only segment bulk add/remove tag jobs (idempotent, audited) from Audience → Saved segments. Small segments process inline; larger jobs stay queued for the worker (`runDueAudienceTagJobs`) with a frozen membership snapshot.',
    operatorActions: ['Audience → Saved segments → Bulk tags on a segment', 'Ensure the queue worker is running', 'Retry failed jobs from the dialog or POST /api/audience-tag-jobs/{id}/retry']
  },
  {
    id: 'campaign_drip',
    title: 'Campaign drip sequences',
    tenantSummary: 'Multi-step template sequences from saved segments.',
    boundary:
      'Multi-step approved-template drips enrolled from saved segments with worker scheduling — not a third-party drip preset marketplace.',
    operatorActions: ['Campaigns → Drip sequences', 'Attach an active segment and approved templates per step']
  },
  {
    id: 'automation_visual_canvas',
    title: 'Automation visual canvas',
    tenantSummary: 'Build reply workflows with triggers, conditions, and actions.',
    boundary:
      'Drag-and-drop node graph with wiring, auto-layout, and inspector — CRM-owned graph UX. Not every third-party automation canvas widget or marketplace template pack.',
    operatorActions: ['Automation → drag nodes from the palette', 'Wire next branches, save, activate', 'Keep the queue worker running for delayed/template jobs']
  },
  {
    id: 'in_chat_webview_chrome',
    title: 'In-chat WebView chrome',
    tenantSummary: 'In-chat browser chrome is controlled by WhatsApp, not this CRM.',
    boundary:
      'WhatsApp/Meta owns the native in-chat WebView chrome (bars, gestures, security UI). This CRM sends CTA URL buttons and hosts transactional/form pages; it cannot restyle Meta’s in-chat shell.',
    operatorActions: ['Use Hosted pages + send_webview_cta nodes', 'Publish HTTPS APP_URL for Meta CTAs', 'Do not expect custom chrome inside the WhatsApp client']
  },
  {
    id: 'meta_live_verification',
    title: 'Meta live verification',
    tenantSummary: 'Live messaging requires a connected WhatsApp account and verified delivery.',
    boundary:
      'WABA connect, published Flows, and webhook delivery on HTTPS APP_URL require your Meta app credentials and a live subscription. Code readiness is not the same as Meta-verified production traffic.',
    operatorActions: ['Meta Setup → connect WABA', 'Publish at least one Flow', 'Subscribe webhook to APP_URL/api/webhooks/meta', 'Run npm run worker']
  },
  {
    id: 'integration_marketplace',
    title: 'Integration marketplace',
    tenantSummary: 'Connect curated partners and webhook recipes for this workspace.',
    boundary:
      'Operator-controlled connector catalog plus Zapier/Make/n8n webhook recipes. Not a hosted app store with 2000+ OAuth apps.',
    operatorActions: ['Edit integration_catalog in platform settings', 'Issue workspace API keys and signed webhooks']
  },
  {
    id: 'mm_lite_optimizer',
    title: 'MM Lite / Marketing Messages',
    tenantSummary: 'Marketing Messages availability depends on Meta onboarding status.',
    boundary:
      'TTL, benchmarks, and creative optimization are owned by Meta. This CRM documents eligibility, send path, and gates marketing sends when not ONBOARDED.',
    operatorActions: ['Refresh entitlements on Capabilities', 'Configure campaigns only when MM API status is ONBOARDED']
  },
  {
    id: 'ai_safety_eval',
    title: 'AI safety & evaluation',
    tenantSummary: 'Safety events and reply samples for AI assistants in this workspace.',
    boundary:
      'Event log, injection heuristics, caps, and lightweight reply samples — not a full red-team or model-eval product.',
    operatorActions: ['Review Team → AI safety panel', 'Set platform AI caps in Super Admin features']
  },
  {
    id: 'slo_certification',
    title: 'Load-test & SLO certification',
    tenantSummary: 'Platform load and reliability attestation for operators.',
    boundary:
      'Queue metrics, send-event thresholds, and VPS attestation recording — you still run real volume tests on your infrastructure.',
    operatorActions: ['node scripts/load-test-slo.mjs after volume test', 'Record run in Super Admin SLO panel']
  },
  {
    id: 'a11y_certification',
    title: 'Accessibility E2E',
    tenantSummary: 'Automated accessibility checks for supported browser layouts.',
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
