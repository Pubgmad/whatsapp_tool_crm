# CRM production gap status (14-item review)

Updated 2026-10-07. **Production standard** here means: tenant-safe code path, owner/manager controls, audit trail, worker processing, and documented live-provider verification — not “every AiSensy marketing claim is certified on your VPS.”

| # | Area | In repo today? | Production-grade? | What to do live |
| --- | --- | --- | --- | --- |
| 1 | AI actions & intent routing | **Yes** — owner-approved actions (`lib/ai-actions.js`), optional **autonomous** path gated by platform `ai_autonomous_actions_enabled` / env; intent routing on handoff | Partial — CRM writes remain allowlisted; not arbitrary API tools | Enable proposals; turn on autonomous only after platform gate; test approve/reject |
| 2 | WhatsApp webviews | **Yes** — transactional hosted pages with Flow runtime (`/w/[viewId]`, `TransactionalWebview`); legacy pages are `wa.me` only | Partial — hosted page is not Meta’s in-chat WebView chrome; native Flow send is the in-WhatsApp path | Use **Send in WhatsApp** for Flow-bound journeys; use page links only when intentional |
| 3 | Shopify payment/refund ledger | **Yes** — OAuth (`lib/shopify-auth.js`), verified settlement (`verifiedShopifySettlement`), worker reconcile (`reconcileShopifyOrderForDraft`), **refund webhook hook** | Partial — needs connected Shopify OAuth + `read_orders`; manual admin token only if OAuth env vars unset | Connect Shopify OAuth; register `orders/updated` + `refunds/create` webhooks to connector URL |
| 4 | Broader CRM object sync | **Yes** — import + outbound update + optional **create** (`lib/crm-object-outbound.js`, `sync_outbound_create_objects_enabled`) | Partial — not a full CRM workflow engine | Enable object sync, outbound push, then create toggle after field review |
| 5 | Chatbot builder | Rule/API automation nodes + UI | Partial — not a full visual simulator or AI workflow router | Use automation replay tests; extend builder UX as needed |
| 6 | Native Flows | Multi-screen compile, runtime, booking/order, **per-screen funnel/drop-off** for managed runtime (`lib/flow-screen-analytics.js`) | Partial — Meta-only hosted endpoints still invite-level | Publish Flows; route data through `/api/whatsapp/flows/runtime/data/...` for screen events |
| 7 | Broadcasts & retargeting | Schedule, segments, approval, retry failed; **retarget presets**, live segment refresh, dynamic audience on queue | Partial — recurring campaigns; retarget needs Meta delivery + click/button events | Run `db:init`; use Results retarget panel; enable tracked links for click presets |
| 8 | Templates | Create, sync, advanced send | Partial — **`content_revision`** increments on Meta sync and local edits | Use Templates sync after approval; avoid editing approved rows in place |
| 9 | CTWA ads + experiments | Ads CRUD, readiness banner, Meta insights report, read-only AI advice | Partial — spend still requires approved ad account | Connect ad account; run insights report; log experiments manually |
| 10 | Marketing Messages API | Eligibility sync + send path | Partial — journey report includes **MM API send counts** | Refresh entitlements; confirm `ONBOARDED`; send test MARKETING campaign with `marketing_messages_api` |
| 11 | Calling | WebRTC + Meta settings | Partial — uses **support policy hours** for agent availability; no separate calling-template product | Configure TURN; enable calling in Meta Setup; align Team support hours |
| 12 | Unified analytics | Journey + referrals + orders | Partial — ad→chat→order join is evidence-qualified; Flow funnel is invite-level | Export journey report; treat unknown attribution explicitly |
| 13 | Super Admin features | **17** workspace toggles (`lib/feature-controls.js`) incl. `marketing_messages` | Good for module kill switches; not per-Meta-permission | Use company overrides + operations dashboard |
| 14 | Production verification | Unit/integration tests; Playwright public/auth + **mobile workspace** (`e2e/workspace-mobile.spec.js` on Pixel 7 / iPhone 15) | **Not live-certified** on real handsets | Run Playwright with local `DATABASE_URL`; manual Meta/Shopify drills on VPS |

## Corrections to common misconceptions

- **AI knowledge import** exists: `/api/ai-agent/import` + UI in `components/ai-support-settings.js` (HTTPS pages + documents).
- **AI booking/order/CRM actions** exist but require **owner approval** — they do not auto-execute on every inbound message.
- **Salesforce/Hu bSpot object sync** exists behind **Integrations → Sync Companies/Deals** (or Accounts/Opportunities); it is not contacts-only.
- **Shopify OAuth** is implemented for availability/connectors; legacy manual shop tokens are a fallback when platform OAuth env is unset.
