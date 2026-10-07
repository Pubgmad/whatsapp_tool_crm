# CRM production gap status (14-item review)

Updated 2026-10-07. **Production standard** here means: tenant-safe code path, owner/manager controls, audit trail, worker processing, and documented live-provider verification — not “every AiSensy marketing claim is certified on your VPS.”

| # | Area | In repo today? | Production-grade? | What to do live |
| --- | --- | --- | --- | --- |
| 1 | AI actions & intent routing | **Yes** — owner-approved actions (`lib/ai-actions.js`), proposals queue, booking Flow send after approve; **intent routing** assigns conversations on AI handoff (`lib/ai-intent-routing.js`) | Partial — not autonomous execution; CRM write tools are allowlisted attributes + order status + booking invite | Enable action proposals + intent routes in AI settings; test approve/reject; verify OpenAI quota |
| 2 | WhatsApp webviews | **Yes** — transactional hosted pages with Flow runtime (`/w/[viewId]`, `TransactionalWebview`); legacy pages are `wa.me` only | Partial — hosted page is not Meta’s in-chat WebView chrome; native Flow send is the in-WhatsApp path | Use **Send in WhatsApp** for Flow-bound journeys; use page links only when intentional |
| 3 | Shopify payment/refund ledger | **Yes** — OAuth (`lib/shopify-auth.js`), verified settlement (`verifiedShopifySettlement`), worker reconcile (`reconcileShopifyOrderForDraft`), **refund webhook hook** | Partial — needs connected Shopify OAuth + `read_orders`; manual admin token only if OAuth env vars unset | Connect Shopify OAuth; register `orders/updated` + `refunds/create` webhooks to connector URL |
| 4 | Broader CRM object sync | **Yes** — HubSpot companies/deals + Salesforce accounts/opportunities (`lib/crm-objects.js`, `sync_objects` toggle) | Partial — contact-scoped links, not full bidirectional CRM workflow engine | Turn on object sync; map fields; run periodic worker sync |
| 5 | Chatbot builder | Rule/API automation nodes + UI | Partial — not a full visual simulator or AI workflow router | Use automation replay tests; extend builder UX as needed |
| 6 | Native Flows | Multi-screen compile, runtime, booking/order | Partial — linear multi-screen; **answer-based branches** in designer (`branchField` / `branchRules`); per-screen drop-off is invite-level only | Publish Flows; use runtime transactional mode for inventory |
| 7 | Broadcasts & retargeting | Schedule, segments, approval, retry failed; **retarget presets**, live segment refresh, dynamic audience on queue | Partial — recurring campaigns; retarget needs Meta delivery + click/button events | Run `db:init`; use Results retarget panel; enable tracked links for click presets |
| 8 | Templates | Create, sync, advanced send | Partial — **`content_revision`** increments on Meta sync and local edits | Use Templates sync after approval; avoid editing approved rows in place |
| 9 | CTWA ads + experiments | Ads CRUD + read-only AI advice | Partial — **`whatsapp_ad_experiments`** records owner-started measurement windows (no auto budget changes) | Run advice; log experiment; apply changes manually in Meta |
| 10 | Marketing Messages API | Eligibility sync + send path | Partial — journey report includes **MM API send counts** | Refresh entitlements; confirm `ONBOARDED`; send test MARKETING campaign with `marketing_messages_api` |
| 11 | Calling | WebRTC + Meta settings | Partial — uses **support policy hours** for agent availability; no separate calling-template product | Configure TURN; enable calling in Meta Setup; align Team support hours |
| 12 | Unified analytics | Journey + referrals + orders | Partial — ad→chat→order join is evidence-qualified; Flow funnel is invite-level | Export journey report; treat unknown attribution explicitly |
| 13 | Super Admin features | **17** workspace toggles (`lib/feature-controls.js`) incl. `marketing_messages` | Good for module kill switches; not per-Meta-permission | Use company overrides + operations dashboard |
| 14 | Production verification | Unit/integration tests; Playwright public/auth | **Not live-certified** — authenticated E2E needs `PLAYWRIGHT_*` env (see `e2e/README.md`) | Run worker on VPS, health 200, manual Meta/Shopify drills |

## Corrections to common misconceptions

- **AI knowledge import** exists: `/api/ai-agent/import` + UI in `components/ai-support-settings.js` (HTTPS pages + documents).
- **AI booking/order/CRM actions** exist but require **owner approval** — they do not auto-execute on every inbound message.
- **Salesforce/Hu bSpot object sync** exists behind **Integrations → Sync Companies/Deals** (or Accounts/Opportunities); it is not contacts-only.
- **Shopify OAuth** is implemented for availability/connectors; legacy manual shop tokens are a fallback when platform OAuth env is unset.
