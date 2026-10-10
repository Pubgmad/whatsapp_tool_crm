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
      'Manager-only segment bulk add/remove tag jobs (idempotent, audited) from Audience → Saved segments. Small segments process inline; larger jobs stay queued for the worker (`runDueAudienceTagJobs`) with a frozen membership snapshot.',
    operatorActions: ['Audience → Saved segments → Bulk tags on a segment', 'Ensure the queue worker is running', 'Retry failed jobs from the dialog or POST /api/audience-tag-jobs/{id}/retry']
  },
  {
    id: 'campaign_drip',
    title: 'Campaign drip sequences',
    boundary:
      'Multi-step approved-template drips enrolled from saved segments with worker scheduling — not an AiSensy drip preset marketplace.',
    operatorActions: ['Campaigns → Drip sequences', 'Attach an active segment and approved templates per step']
  },
  {
    id: 'automation_visual_canvas',
    title: 'Automation visual canvas',
    boundary:
      'Drag-and-drop node graph with wiring, auto-layout, and inspector — CRM-owned graph UX. Not a pixel-perfect clone of every AiSensy canvas widget or marketplace template pack.',
    operatorActions: ['Automation → drag nodes from the palette', 'Wire next branches, save, activate', 'Keep the queue worker running for delayed/template jobs']
  },
  {
    id: 'in_chat_webview_chrome',
    title: 'In-chat WebView chrome',
    boundary:
      'WhatsApp/Meta owns the native in-chat WebView chrome (bars, gestures, security UI). This CRM sends CTA URL buttons and hosts transactional/form pages; it cannot restyle Meta’s in-chat shell.',
    operatorActions: ['Use Hosted pages + send_webview_cta nodes', 'Publish HTTPS APP_URL for Meta CTAs', 'Do not expect custom chrome inside the WhatsApp client']
  },
  {
    id: 'meta_live_verification',
    title: 'Meta live verification',
    boundary:
      'WABA connect, published Flows, and webhook delivery on HTTPS APP_URL require your Meta app credentials and a live subscription. Code readiness is not the same as Meta-verified production traffic.',
    operatorActions: ['Meta Setup → connect WABA', 'Publish at least one Flow', 'Subscribe webhook to APP_URL/api/webhooks/meta', 'Run npm run worker']
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
