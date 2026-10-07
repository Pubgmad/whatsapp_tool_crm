# WhatsApp CRM capability audit

Audited 2026-10-03 against the local codebase. This records implementation evidence, not a live-provider certification. AiSensy is a capability benchmark only; its branding and product design are not a specification for this application.

Legend: Full = code path and data model found; Partial = material path exists but lacks a requested workflow; Improve = working path with a production or UX weakness; Missing = no implementation found; External = needs a third-party account; Meta = requires a supported Meta asset/API entitlement; N/A = not appropriate for this web product. A "Full" row still requires live account testing before launch.

Matrix markers: ✅ Full; 🟡 Partial; ⚠️ Improve; ❌ Missing; 🔗 External integration; 🟣 Meta approval/API dependency; 🔵 Not applicable. Combined statuses indicate multiple conditions, not additional approvals already granted.

| Feature | Current CRM evidence | AiSensy benchmark | Meta capability | Status | Missing / weak area | Implementation required |
| --- | --- | --- | --- | --- | --- | --- |
| Cloud API onboarding and WABA/phone assets | `lib/whatsapp-operations.js`, `lib/meta.js`, Embedded Signup routes | Business API onboarding | Cloud API, Management API, Embedded Signup; WhatsApp permissions | Improve + Meta | Live onboarding per customer and entitlement not verified here | Live account tests and failure/reconnect runbook |
| Webhooks and monitoring | `lib/actions.js`, `lib/meta-webhook-queue.js`, worker and health routes | Message/status tracking | WABA subscriptions and webhook fields | Improve | Deploy-specific worker and callback validation | Exercise signed callbacks, alerting and stale-worker recovery |
| Shared inbox and team routing | `lib/actions.js`, `lib/support-policy.js`, workspace inbox | Multi-agent chat/handoff | Cloud API messages/statuses; routing is CRM-owned | Partial | Browser/mobile and high-volume queue validation | Test assignment, handoff, notes, search and concurrent agents |
| Contacts and consent | Contact routes, `lib/actions.js`, `lib/segments.js`, consent tables | Contact CRM and segmentation | CRM-owned; Meta requires compliant opt-in for outbound | Improve | Imported third-party data must not imply consent | Keep consent provenance and test import/export tenant boundaries |
| Broadcasts/campaign lifecycle | `lib/actions.js`, `lib/campaign-controls.js`, queue worker | Broadcasting, scheduling, retargeting | Approved templates, messages, status webhooks | Improve + Meta | Provider throttling and live scale proof | Load and failure/retry tests with approved templates |
| Click/read/reply retargeting | `lib/click-tracking.js`, `lib/segments.js`, campaign records | Click tracking and audiences | Message status webhooks and CRM-owned tracked links | Partial | Evidence completeness differs by event/source | Verify actual event-to-segment attribution |
| Automation and chatbot | `lib/automation.js`, `lib/automation-node-runtime.js`, queue | Visual chatbot/workflow engine | Message and Flow APIs; engine is CRM-owned | Partial | Visual complexity, live integrations, failure handling | End-to-end workflow replay and UX improvement |
| AI support | `lib/ai-support.js`, knowledge/settings and draft route | Contextual AI agent | Third-party AI; not a Meta entitlement | Partial + External | Human-reviewed draft, not autonomous tool-using agent | Explicit consent/policy, tool boundaries, handoff and evaluations before autonomous sends |
| Native WhatsApp Forms | Flow design/runtime/crypto and template modules | Forms and booking | WhatsApp Flows API; WABA/phone configuration | Partial + Meta | External booking/order confirmation is not atomic | Provider-specific transaction orchestration and compensation |
| Calling | `lib/whatsapp-calling.js`, calling UI | Business calling | Calling API, eligible number | Partial + Meta | Live phone/WebRTC validation | Test media, permissions and callbacks on eligible number |
| Catalog and interactive messages | `lib/whatsapp-commerce.js`, template composer, catalog/product messages | Catalog and carousels | Cloud API catalog, templates, interactive messages | Partial + Meta | Per-WABA catalog approval and real product sync | Live catalog/template validation and sync rules |
| Customer payments | Native payment and merchant checkout modules, Razorpay webhooks | In-chat payment status | Region/provider-specific native payment support | Partial + Meta + External | Hosted payment links are not automatically native in-chat payment | Validate eligible region/PSP, reconcile actual payment webhooks |
| Click-to-WhatsApp ads | `lib/whatsapp-ads.js`, referrals, ad reporting | CTWA/AI Ads Manager | Marketing API and ad/page asset permissions | Partial + Meta | AI advice is read-only, not autonomous optimization | Test ad creation/edit/reporting with approved permissions and assets |
| WhatsApp webviews/entry points | `lib/whatsapp-webviews.js`, `lib/whatsapp-widget.js`, entry-point routes | Webviews, widgets, QR/links | CTA URLs and WhatsApp entry points; hosted pages are app-owned | Partial | Hosted page is not proof of a Meta webview entitlement | Test link opening in actual WhatsApp clients and attribution |
| Commerce automation | `lib/provider-connectors.js`, `lib/commerce-automation.js` | Shopify/WooCommerce notifications and recovery | CRM/third-party behavior; uses WhatsApp messaging | Partial + External | Signed events exist, no complete store OAuth/two-way inventory/order lifecycle | Provider OAuth, reconciliation and event coverage |
| Live availability | `lib/external-availability.js`, `lib/flow-runtime.js` | Booking/product availability | Google/Shopify APIs, plus WhatsApp Flows | Partial + External | Read-only check; no external reservation/checkout event | Transactional provider reservation and conflict handling |
| HubSpot CRM | `lib/hubspot-contacts.js` and OAuth routes | CRM connectors | Third-party API | Partial + External | Bounded contact sync only; not full object/field two-way sync | Live OAuth, field mapping and conflict policy |
| Salesforce CRM | No Salesforce route or connection table | CRM connector | Third-party API | Missing + External | No OAuth or object mapping | Separate scoped connector design |
| Generic inbound/outbound integrations | `lib/workspace-integrations.js`, signed provider connectors | Broad APIs/webhooks | CRM-owned | Partial | Contract versioning and per-destination operational UI need review | Expand retry/dead-letter and delivery diagnostics |
| Tenant security | Business IDs, workspace membership, PostgreSQL RLS across schema/migrations | Multi-tenant SaaS | CRM-owned | Improve | Every new table and public endpoint needs explicit isolation test | Security regression suite and live deployment review |
| Super Admin platform controls | `lib/super-admin.js`, plans, flags, content/settings UI | SaaS administration | CRM-owned | Partial | Content is key/value editing, not structured publishing | Dedicated content model, preview and publish flow |
| Public website | `app/page.js` redirects to login | Product information, pricing, FAQ, trust pages | CRM-owned | Missing | No public product experience | Admin-managed product site and legal links |
| Public content editor | `components/super-admin-app.js` generic textarea | Content management | CRM-owned | Partial | No structured blocks, preview, section order/visibility | Safe structured editor with revision/publish semantics |
| Platform logo/favicon | No upload API or stored logo asset | Admin branding | CRM-owned | Missing | No validated image storage or cache invalidation | Super Admin asset upload, validation, dynamic delivery |
| Browser/mobile UX | Responsive CSS and limited Playwright specs | Professional cross-device UI | N/A | Improve | Safari/iOS/Android live coverage not established | Browser/device QA, especially inbox keyboard/scroll |
| Production operations | Worker, health, RLS, tests, rotation scripts | SaaS reliability | N/A | Improve | Backups, alerting, provider E2E and load not certified | Deploy drill and provider-specific validation |

## Priority

1. Critical: public-site publication model and safe branding assets; preserve working login and Meta callbacks; verify tenant isolation on new routes.
2. High: native Flow external transaction consistency, live-provider acceptance tests, webhook/worker deployment checks.
3. Medium: stronger HubSpot/store sync, admin previews/revisions, cross-browser UX, connector diagnostics.
4. Enhancement: Salesforce connector and autonomous AI actions only after explicit data/tool policies and provider account testing.

## Source boundary

- [AiSensy feature inventory](https://aisensy.com/features) is a commercial benchmark, not a Meta API contract.
- [Meta's official WhatsApp API collection](https://www.postman.com/meta/whatsapp-business-platform/overview) distinguishes Cloud API, Management API, Flows and Embedded Signup.
- [Meta Business Platform features](https://whatsappbusiness.com/products/business-platform-features/) documents messaging, interactive messages, catalog messages, read receipts and entry points.

The repository README contains stale claims (for example, later-integrated capabilities described as absent). Runtime code and tests take precedence in this audit.

## Upgrade delivered in this change

- A public root page now renders only published, validated sections and active, visible database plans. It does not display draft copy or sample analytics.
- Super Admin can edit section order, visibility, structured text blocks, CTA destinations, layout and alignment; draft saves use revision checks and publishing is explicit. `terms` content has its own public route only when published.
- Logo, favicon and hero images are uploaded by Super Admin through a size-bounded multipart endpoint, decoded/re-encoded server-side, stored in PostgreSQL and served with versioned URLs. The logo is used in the public site, login/workspace shell and Open Graph preview; favicon metadata follows the uploaded asset.
- The critical `next/og` advisory affecting the prior pinned Next.js version was addressed by upgrading to a patched Next.js release. `npm audit --omit=dev` reports no known vulnerabilities at the time of this audit.

This does **not** complete all rows above. The live provider acceptance checks, transactional external booking/order confirmation, deeper CRM sync, autonomous AI design, content population and broad authenticated browser/device workflows remain open. Public legal content must be written and approved by the platform operator before publishing.
