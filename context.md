# WhatsApp CRM: AI development handoff

Snapshot: 2026-10-07, local checkout at `C:\Users\systems\Downloads\whatsapp_tool_prototype`. For the AiSensy-class **code parity matrix** (what is implemented vs what still needs live Meta/CRM smoke), see **`PRODUCTION_PARITY.md`**. This file remains a continuity record, **not** a live production certification. Re-check Git, database, provider accounts, and VPS before relying on any operational claim. `UNKNOWN - REQUIRES VERIFICATION` means code or configuration does not establish the fact. `IMPLEMENTED - REQUIRES LIVE VERIFICATION` means a real integration path exists but has not been demonstrated against a production account here. Do not put credentials in this file.

## 1. Read this first: identity and architecture

The package is `whatsapp-growth-desk` 3.0.0: a browser-only, multi-tenant WhatsApp CRM/SaaS for business owners, managers, and agents. It covers Cloud API onboarding, inbox, contacts, campaigns, templates, automations, AI support, commerce, acquisition, ads, calling, billing, a platform Super Admin, and a public site. This is not a native Android/iOS application. Use AiSensy only as a capability benchmark, never as a source of branding, UI, copy, or a guarantee of Meta entitlement.

- Stack: Next.js 16.3.8 App Router, React 19.2.8, JavaScript ES modules, PostgreSQL (`pg`), server-side Node, `sharp`, Meta Business SDK, Razorpay, Stripe, Playwright. See `package.json`.
- Layout: `app/` pages and API routes; `components/` client UI; `lib/` domain services, auth and provider calls; `db/` schema/migration SQL; `scripts/` migration, worker and test runners; `tests/` Node tests; `e2e/` Playwright. API routes are usually thin wrappers around `lib/` functions.
- Data flow: browser -> authenticated `/api/*` route -> `lib/*` -> tenant-scoped PostgreSQL -> provider API; verified provider webhooks -> durable database event/job -> worker -> status/analytics -> UI. Do not equate an API route or UI button with a successful end-to-end workflow.
- Core commands: `npm run db:init`, `npm run dev`, `npm run build`, `npm start`, `npm run worker`, `npm test`, `npm run test:integration`, `npm run test:e2e`. `scripts/db-init.mjs` applies `db/schema.sql` and the feature SQL files in a transaction and seeds platform settings/plans. `scripts/worker.mjs` polls `/api/jobs/run` using `JOB_RUNNER_SECRET`; it is a **separate process** from `next start`.

## 2. Git and GitHub: critical branching rule

At this snapshot `git status --short --branch` reports `main...origin/main` with a **large dirty worktree**. HEAD `4135e78` (`Keep inbox drafts isolated and guard AI suggestions`), remote `origin` is `https://github.com/Pubgmad/whatsapp_tool_crm.git`. Recent commits: `8fa72d1` Meta callback/palette; `2834a15` tenant context; `11c418d` auth/signup; `1b042eb` email/selector hardening; `9fbb562` admin CRM controls. Local branches: `main`, `production_saas`, `production-ready`, `production-ui`; the remote has the same names. `origin/HEAD` points to `origin/main`. Last checked tips: `origin/main=4135e78`, `origin/production_saas=3742693`; local `production_saas=229ccf1` (one local commit ahead of its tracking branch). `git rev-list --left-right --count origin/main...origin/production_saas` returned `51 0`: remote `production_saas` is 51 commits behind `main` at this snapshot. These are local-tracking-ref observations; fetch and recheck before acting.

**Future production SaaS development belongs only on `production_saas`. Never develop on, push to, or merge into `main` without explicit instruction.** The present checkout is on `main` and contains user/uncommitted work: dozens of modified files plus untracked CRM connector, Shopify/Calendar, AI action/reply, webhook queue, public-site/CMS, webview, migration, and test files. Those changes are not proved to be on either remote branch. Do **not** blindly `git switch`, reset, clean, or cherry-pick: first preserve/inspect the dirty state and agree a non-destructive reconciliation path. Check `git branch -avv`, `git status --short`, `git remote -v`, `git fetch`, and branch divergence. Never push these local changes straight to `main`. The correct eventual GitHub target is `origin/production_saas`, after intentional reconciliation and testing.

## 3. Current status at a glance

| Area | Status | Evidence / boundary |
| --- | --- | --- |
| Production foundation | PARTIAL | Auth, RLS, health, migrations and queue worker exist; VPS/backup/alerting/live smoke checks are not certified. |
| Core CRM | PARTIAL | Contacts, shared inbox, notes, team, campaigns and analytics have code; concurrency/scale and live workflows need tests. |
| WhatsApp/Meta | IMPLEMENTED - REQUIRES LIVE VERIFICATION | Embedded Signup, WABA/phone assets, Cloud API, templates, webhooks, Flows, calling, commerce and ads paths exist. App/asset entitlement and production delivery are external. |
| AI/automation | PARTIAL | OpenAI grounded suggestions, optional auto-replies and owner-reviewed action proposals; advanced tool autonomy is intentionally constrained. |
| Integrations | PARTIAL | Shopify, Google Calendar, Salesforce, HubSpot, Razorpay and Stripe code; latest work is uncommitted; live accounts not certified. |
| Super Admin and SaaS | PARTIAL | Separate Super Admin auth, companies, plans, flags, settings, CMS and billing; operational completeness not verified. |
| Public website | PARTIAL | Published sections, plans and brand assets render; nav/content model is limited and content/legal approval is operator-owned. |
| Security | PARTIAL | Signed sessions, password hashing, CSRF/origin checks, webhook signatures and RLS; full adversarial/tenant audit outstanding. |
| UI/UX | UNTESTED | Responsive CSS and Playwright specs exist; no verified current device/browser matrix. |
| Deployment | UNKNOWN - REQUIRES VERIFICATION | Prior user VPS evidence exists below; no live access or deploy was performed for this snapshot. |

## 4. WhatsApp and Meta: what the code does

The user's reported Meta app is `2166072280614956`, Business Portfolio `1610818760824687`, and an Embedded Signup configuration was created. Those IDs are user-provided historical context, **not** proof of active VPS configuration; do not embed them in business logic. Meta app mode, latest review outcome, published status, WABA/number eligibility, and current permission grants are `UNKNOWN - REQUIRES VERIFICATION`. Prior user screenshot showed an App Review request for `pages_show_list`, `ads_read`, `pages_read_engagement`, `ads_management`, `business_management`, Marketing API Access Tier, and renewal entries for WhatsApp permissions. A request is not approval. `whatsapp_business_management` and `whatsapp_business_messaging` are necessary for many code paths; precise approval/asset-task status must be checked in Meta.

- `lib/meta-onboarding.js` plus `/api/meta/embedded-signup/*` exchange the authorization code server-side, bind a WABA and phone to a business, store encrypted access tokens, and subscribe a WABA. `db/schema.sql` has `whatsapp_accounts` and `whatsapp_phone_numbers`; WABA ID and Phone Number ID are **different identifiers**. `lib/meta-health.js`, `/api/meta/connection/*`, and UI in `app/app/settings/whatsapp/` support checks, disconnect and guided reconnect. Revoked tokens require supported reauthorization; there is no invented token refresh.
- `lib/meta.js`, `lib/actions.js`, `/api/messages/*`, `/api/templates/*` implement outbound replies/templates/media and campaign sends. `lib/actions.js` stores inbound messages, statuses, opt-outs and campaign recipient state. Template synchronization, ownership and insights use `lib/whatsapp-template-insights.js`, `db/template-ownership.sql` and template routes. Actual approved template and media sending still need live WABA tests.
- `/api/webhooks/meta` GET verifies a configured challenge token and POST verifies `x-hub-signature-256` in `lib/actions.js`; `lib/meta-webhook-queue.js` durably hashes/enqueues changes, deduplicates, retries up to eight attempts and exposes Super Admin replay (`/api/super-admin/meta-webhooks`). `scripts/worker.mjs` processes the queue. Inspect actual subscribed fields in the Meta dashboard; code alone cannot prove `messages`, quality, template, account and calling subscriptions are active.
- Advanced areas have real modules: `lib/whatsapp-calling.js`, `lib/whatsapp-ads.js`, `lib/whatsapp-commerce.js`, `lib/whatsapp-native-payments.js`, `lib/flow-runtime.js`, `lib/whatsapp-experiences.js`, `lib/whatsapp-conversions.js`, `lib/coexistence.js`, and corresponding UI/API/SQL. Native Flows use data-exchange endpoints and encrypted payload support. The hosted transactional page `/w/[viewId]` is a web CTA, **not guaranteed to render inside every WhatsApp client**. A Shopify draft/order intent is not a paid order; only verified provider events may settle payments.
- Marketing Messages API status is checked against WABA capability in `lib/actions.js`; campaign sending will reject non-onboarded status. Coexistence has synchronization state in `db/schema.sql` and `lib/coexistence.js`. Per-number calling, native payments, carousel/catalog, ads, and coexistence/history all have Meta/asset/region-specific prerequisites. `META_EMBEDDED_SIGNUP_CONFIG_ID`, `META_COEXISTENCE_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET`, etc. belong in server environment, never client code or docs values.

## 4b. Documented production boundaries (“honest limits”)

Six areas are implemented in-product with explicit boundaries (not full AiSensy/Meta parity): **Groups** (Cloud API only, inbox 1:1-first), **integration marketplace** (operator catalog + webhook recipes), **MM Lite** (Meta-owned optimizer; CRM gates send path), **AI safety** (events + caps, not red-team eval), **SLO cert** (metrics + VPS attestation), **a11y** (Playwright matrix, not WCAG audit). Source of truth: `lib/honest-product-limits.js`, UI callouts, `GET /api/workspace/honest-limits`, Super Admin **Improvement backlog** (`GET /api/super-admin/improvement-backlog`). After E2E: `npm run record:a11y`; after load test: `npm run record:slo -- --note "…"`.

## 5. AiSensy capability benchmark

Official benchmark checked 2026-10-07: [platform features](https://aisensy.com/features), [WhatsApp Flows](https://aisensy.com/features/whatsapp-flows), [AI agents](https://aisensy.com/features/whatsapp-ai-agents). Their descriptions are marketing/product claims, not a Meta API contract. Status legend: `CODE` = implementation found, `PARTIAL` = material limitation, `MISSING` = not found, `LIVE` = real-account validation absent, `META` = entitlement/eligibility needed. No row implies parity.

| Capability | AiSensy benchmark | Our CRM evidence | Status | Quality / production ready | Missing work |
| --- | --- | --- | --- | --- | --- |
| Live chat, shared inbox, assignment, handoff | Multi-agent support | `lib/actions.js`, `lib/support-policy.js`, inbox/team UI | CODE+LIVE | Not certified | Concurrent-agent, SLA and device tests |
| Contacts, consent, tags, attributes, import/export | CRM audience | contacts/segments routes, consent tables | CODE+LIVE | Not certified | Import provenance and tenant/load tests |
| AI answers, knowledge, routing | AI agents | `lib/ai-support.js`, `lib/ai-knowledge-import.js`, `lib/ai-auto-replies.js` | PARTIAL+LIVE | Not certified | Real OpenAI evaluation, handoff/abuse/cost tests |
| AI CRM/booking/order actions | Tool-using agents | `lib/ai-actions.js`, `lib/ai-booking-action.js` | PARTIAL+LIVE | Owner-reviewed only | Expand only with approved contracts and compensation |
| Chatbot builder, branches, API nodes | Visual chatbots | `lib/automation.js`, `lib/automation-node-runtime.js` | CODE+LIVE | Not certified | Complex workflow and failure replay tests |
| Native multi-screen Flows/forms | Dynamic data, submission | `lib/flow-runtime.js`, `lib/flow-design.js`, `lib/whatsapp-flow-crypto.js` | PARTIAL+META+LIVE | Not certified | Verify real Flow publication, conditional paths, drop-off, external transaction semantics |
| Broadcasts, scheduling, personalization | Campaign marketing | `lib/actions.js`, `lib/campaign-controls.js`, campaign worker | CODE+META+LIVE | Not certified | Scale, rate-limit, timezone, provider failures |
| Segments, retargeting, clicks | Engagement audiences | `lib/segments.js`, `lib/click-tracking.js`, `lib/audience-rules.js` | CODE+LIVE | Not certified | End-to-end click/status attribution |
| Templates, carousel, catalog cards | Rich templates | `lib/advanced-template-components.js`, `lib/template-send-components.js`, composer | PARTIAL+META+LIVE | Not certified | Actual WABA/format approval and send coverage |
| Catalog, orders, checkout recovery | Commerce | `lib/whatsapp-commerce.js`, `lib/commerce-automation.js`, `lib/provider-connectors.js` | PARTIAL+LIVE | Not certified | Real catalog/order reconciliation, opt-in safeguards |
| Native WhatsApp payment vs hosted checkout | Payments | `lib/whatsapp-native-payments.js`, `lib/merchant-payments.js`, Razorpay webhook | PARTIAL+META+LIVE | Not certified | Region/PSP eligibility and event-ledger tests |
| Webviews | In-app journeys | `lib/whatsapp-webviews.js`, `/w/[viewId]` | PARTIAL+LIVE | Hosted page only | Test client behavior; use native Flow for guaranteed in-chat |
| Links, QR, website acquisition | Entry points | `lib/whatsapp-entry-points.js`, `lib/whatsapp-widget.js` | CODE+LIVE | Not certified | Device, attribution and tenant tests |
| CTWA ads, reporting | Ads Manager | `lib/whatsapp-ads.js`, referral/analytics modules | PARTIAL+META+LIVE | Not certified | Approved permissions, account/Page access, create/edit/report acceptance |
| AI Ads optimization | AI Ads Manager | `lib/whatsapp-ad-advice.js` | PARTIAL+LIVE | Advice, not autonomous optimizer | Performance evaluation and guarded change approval |
| Calling | WhatsApp customer engagement | `lib/whatsapp-calling.js`, calling UI and SQL | PARTIAL+META+LIVE | Not certified | Eligible number, WebRTC, webhook and missed-call tests |
| Shopify | Commerce connector | `lib/shopify-auth.js`, `lib/external-availability.js`, `lib/shopify-drafts.js` | PARTIAL+LIVE | Not certified | Real OAuth, order/payment/refund and failure tests |
| Calendar | Booking connector | `lib/external-availability.js`, `lib/calendar-fulfillment.js` | PARTIAL+LIVE | Not certified | Conflict/cancel/confirmation tests with real calendar |
| Salesforce, HubSpot | CRM connectors | `lib/salesforce-contacts.js`, `lib/hubspot-contacts.js`, `lib/crm-objects.js` | PARTIAL+LIVE | Not certified | Live OAuth, conflict policy, broader write sync |
| Razorpay, Stripe | Payments/billing | `lib/razorpay*.js`, `lib/billing.js`, payment webhooks | PARTIAL+LIVE | Not certified | Real payment/subscription/refund acceptance |
| Webhooks and generic API | Integrations | `lib/workspace-integrations.js`, `lib/provider-connectors.js` | PARTIAL+LIVE | Not certified | Contract versioning, delivery diagnostics, partner tests |
| Analytics/lead attribution | Journey reports | `lib/whatsapp-journey-analytics.js`, conversions/referrals | PARTIAL+LIVE | Not certified | Event-quality and revenue reconciliation |

## 6. Production gaps, ranked

| Severity | Gap | Evidence / completion direction |
| --- | --- | --- |
| CRITICAL | Dirty `main` worktree and branch divergence make deployment/push unsafe | Reconcile non-destructively onto `production_saas`; verify migrations/build/tests; push only intended branch. |
| CRITICAL | VPS worker health and current deployed code unknown | Previous `/api/health` was 503 `worker:stale`; verify two PM2 processes or equivalent, queues, logs and deployed SHA. |
| CRITICAL | New untracked SQL/modules may not exist in production DB/code | Deploy migration transaction and application atomically with backup/rollback plan; validate `schema` health. |
| HIGH | Meta review, app mode, WABA/number entitlements and webhook subscriptions unverified | Check app/asset status, signed callbacks, send/status/templating/calling/ads on live accounts. |
| HIGH | External OAuth/provider flows not acceptance-tested | Run sandbox and real-account start/callback/refresh/revoke/reconnect for Shopify, Google, Salesforce, HubSpot. |
| HIGH | Financial/order/booking consistency | Verify Shopify transactions/refunds, Razorpay/native payment webhook signatures, calendar conflict/cancel, unknown outcomes. Do not mark draft or hosted checkout paid. |
| HIGH | Tenant isolation coverage for new routes/tables and provider callbacks | Exercise cross-company IDs/tokens, public endpoints, RLS, worker system context, webhook ownership. |
| HIGH | AI auto-send/action operational risk | Verify explicit opt-in, platform/company flags, daily cap, groundedness, prompt injection, unknown-delivery review and human handoff. |
| MEDIUM | Webhook and job dead-letter/alerting may need operations work | Queue has retry/replay; add external alerting/runbooks, lag thresholds, sustained load tests. |
| MEDIUM | Public-site CMS is structured, not a full marketing-site builder | Sections, footer/social, link/image blocks via Super Admin; legal copy and brand remain operator-owned. See `lib/public-site.js`. |
| MEDIUM | CRM object sync is not a full CRM engine | Contacts/leads plus optional outbound update/create for Companies/Deals/Accounts/Opportunities (`lib/crm-object-outbound.js`). Conflict policy and custom objects remain operator-defined. |
| MEDIUM | Production operations dashboards | Workspace **Results → Production operations** and `GET /api/workspace/operations` expose queue SLO, rate-limit events, SLA, template matrix, MM readiness, integration catalog. |
| MEDIUM | Browser/accessibility/mobile support is not certified | Test authenticated workflows on desktop/tablet/Android/iOS Chrome/Edge/Safari/Firefox; keyboard, focus, overflow, touch, dialogs, tables and error states. |
| MEDIUM | Data/ops foundation | Verify backups/restore, key rotation, capacity/load, retention, rate-limit store and log redaction on actual VPS. |
| LOW | Seed/default copy and fixed nav may not suit brand | Review `lib/platform.js`, `app/page.js`, `db/public-site.sql` with Super Admin; do not mistake seed copy for actual operator approval. |

No known critical gap should be silently relabeled as complete because a test or route exists. The gap list is bounded by this inspection, not a claim that no other gaps exist.

## 7. Integrations and OAuth audit

| Provider | Start/callback, state, PKCE | Storage/refresh/disconnect | Read/write/webhook and limits | Live status |
| --- | --- | --- | --- | --- |
| Meta Embedded Signup | `/api/meta/embedded-signup/config`, `/complete`; server code exchange in `lib/meta-onboarding.js` | Encrypted WABA token, connection checks, disconnect/reconnect; token recovery requires reauthorization | WABA/phone/subscription and Cloud API; signed Meta webhook queue | IMPLEMENTED - REQUIRES LIVE VERIFICATION |
| Shopify | `/api/whatsapp/availability/shopify/start`, `/callback`; `lib/shopify-auth.js` uses state and Shopify HMAC; no generic PKCE assertion | Tenant-encrypted expiring offline access/refresh tokens; refresh path; connection removal in availability settings | Inventory reads, draft intents/linked orders, transaction/refund reconciliation in `lib/shopify-drafts.js`; signed store event connector separately | IMPLEMENTED - REQUIRES LIVE VERIFICATION |
| Google Calendar | `/api/whatsapp/availability/google/start`, `/callback`; state + PKCE S256 in `lib/external-availability.js` | Encrypted refresh token; Google refresh/revoke and disconnect | FreeBusy reads; event creation/cancel/notice in `lib/calendar-fulfillment.js`; confirmation must be checked in provider | IMPLEMENTED - REQUIRES LIVE VERIFICATION |
| Salesforce | `/api/crm/salesforce/start`, `/callback`; state + PKCE S256 in `lib/salesforce-contacts.js` | Tenant-encrypted tokens, refresh, revoke/disconnect | Contacts/Leads names sync; Account/Opportunity read import and mappings via `lib/crm-objects.js`; no full outbound object sync | IMPLEMENTED - REQUIRES LIVE VERIFICATION |
| HubSpot | `/api/crm/hubspot/start`, `/callback`; state in `lib/hubspot-contacts.js`; no PKCE claim | Tenant-encrypted tokens, refresh; inspect disconnect/revocation semantics | Contacts names sync; Companies/Deals read import and mappings; broader write sync absent | IMPLEMENTED - REQUIRES LIVE VERIFICATION |
| Razorpay merchant and SaaS | Provider keys, not OAuth | Env/server credentials and tenant merchant configuration | Hosted links, eligible native payments, signed webhooks and reconciliation code; distinguish merchant payments from CRM subscriptions | IMPLEMENTED - REQUIRES LIVE VERIFICATION |
| Stripe SaaS | API key, not OAuth | Server secret and webhook secret | Subscription checkout/portal via `lib/billing.js` and signed webhook route | IMPLEMENTED - REQUIRES LIVE VERIFICATION |
| OpenAI | API key, not OAuth | Server env only | Responses API for support and action proposals; no direct browser key | IMPLEMENTED - REQUIRES LIVE VERIFICATION |
| Generic/workspace webhooks | Tenant token/signature, not OAuth | `lib/workspace-integrations.js`, `lib/provider-connectors.js` | Trigger/signed event and queue support, provider-specific scope varies | IMPLEMENTED - REQUIRES LIVE VERIFICATION |

Inspect scopes, token lifecycle, 429/backoff, idempotency, duplicate records, conflict rules, redirect allowlists and disconnect for **each** real account. Shopify confirmation must not be called a paid external order unless verified order/payment events prove it. Salesforce is **not missing in this local checkout**; its new files are untracked and thus not guaranteed to exist in GitHub or VPS.

## 8. Super Admin, public site and dynamic content

Only the platform **Super Admin** is a platform role. `lib/super-admin.js` uses a distinct signed `wcrm_super_session` cookie, separate login/MFA, `super_admins` and platform audit logs; `/super-admin/*` and `/api/super-admin/*` are its namespaces. Company workspace roles are Owner/Manager/Agent. Super Admin manages companies/status, plans, subscriptions/limits, feature flags and per-company overrides, operational settings, legal/privacy, Meta webhook failures, and public-site draft/assets. Relevant files: `components/super-admin-app.js`, `components/public-site-editor.js`, `lib/platform.js`, `lib/feature-controls.js`, `lib/public-site.js`, `db/public-site.sql`.

Public routes: `/` is a published-section single-page site with fragment navigation and database plans; `/terms` renders published terms; `/privacy-policy`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify-email`, `/resend-verification`, `/data-deletion/status` exist. About/features/integrations/security/contact/FAQ are **sections on `/`**, not independent pages. CMS can reorder, show/hide, set title/eyebrow, paragraph/heading/list/quote text, bold/italic whole blocks, local CTA, `plain/split/columns` layout and left/center alignment; save draft with revision conflict detection then publish. React text rendering escapes HTML; CTA path validation restricts to same-origin relative paths. It is **not** a rich WYSIWYG with inline links, arbitrary embedded images/buttons, social links, independent nav/footer design, or flexible alignment/spacing controls. Plans and pricing are read from `subscription_plans` rather than CMS copy. Public brand name/contact text comes from `platform_settings`.

Brand assets: Super Admin uploads logo, favicon, hero via `/api/super-admin/site/asset`; `lib/public-site.js` bounds bytes/dimensions, decodes with `sharp`, re-encodes WebP and stores in PostgreSQL `platform_brand_assets`; `/api/platform/asset/[kind]` serves versioned URLs. Preview/replacement/removal are in the editor. `app/page.js`, layout/auth/workspace components and Open Graph use asset references or text fallback. Verify every desktop/mobile header/footer/login state and cache invalidation; do not assume all legacy icon paths are removed. No separate platform Admin role should be added.

## 9. AI and automation internals

Provider is OpenAI through server-side Responses API; model comes from `OPENAI_MODEL`, not a fixed production business value. `lib/ai-support.js` builds bounded context from recent conversation, active tenant knowledge and optionally verified CRM facts, requests a structured answer/handoff with source IDs, and tracks per-business daily requests. `lib/ai-knowledge-import.js` imports bounded text/document/website content with public-address checks; knowledge remains inactive until reviewed. This is retrieval from stored text, not a vector database. `lib/ai-auto-replies.js` is owner-enabled, gated by platform/company settings, contact/conversation state and daily cap; uncertain deliveries become `unknown` for human review. `lib/ai-actions.js` classifies a narrow allowlist (CRM attribute/order lookup/booking Flow invite), creates proposals and requires Owner approval before stateful action; unknown send outcomes require manual resolution. No general autonomous arbitrary API/tool access should be claimed. Review OpenAI data-sharing consent, evaluation, prompt-injection resistance, source freshness, token cost, and handoff in production.

`lib/automation.js`, `lib/automation-node-runtime.js`, `lib/automation-dispatch.js`, campaign controls and queue tables implement workflow/chatbot dispatch. Live Meta callbacks drive messages/status and queue work; unsupported app/number entitlements are not bypassed by local workflow code.

## 10. Database and security

PostgreSQL schema in `db/schema.sql` defines users, super_admins, businesses, memberships, WhatsApp accounts/phones, contacts/consent, templates, campaigns/recipients/jobs, automation flows/sessions/jobs, conversations/messages/notes, AI knowledge/settings/jobs/actions, subscriptions/plans/billing events, platform settings and audit logs. Feature migrations add Shopify/Calendar availability and settlements, CRM OAuth connections and object links/mappings, Meta webhook queue, public-site documents/assets, ads, calling, commerce, webviews, entry points and more. `lib/db.js` uses tenant/system request context; `db/schema.sql` and new migrations enable RLS/policies for tenant tables. Always verify new tables and transaction context; a business ID in a query is not by itself sufficient isolation proof.

Passwords use salted `scrypt` in `lib/auth.js`; workspace sessions are HMAC-signed, HttpOnly, SameSite=Lax and session-version checked against active membership. `requireSession` calls CSRF/origin and rate limiting; production signup requires Resend email configuration and verification. Super Admin auth is separate and supports MFA. Provider credentials are encrypted server-side in integration tables. Meta/Razorpay/Stripe webhooks have verification paths; review each signature implementation and raw-body handling. `next.config.js` sets response security policy. Security status is **PARTIAL** until tenant cross-access, CSRF, public asset, OAuth state, SSRF, abuse, logging redaction and rotation are tested against deployment. In prior conversation a Meta token/cookie header was pasted: treat previously exposed credentials as compromised and rotate/revoke via provider/admin channels; never repeat their values.

## 11. Tests, UI and hardcoded-value audit

Tests exist under `tests/` (Node unit/integration) and `e2e/` (Playwright auth, public pages, transactional webview); `playwright.config.js` defines browser projects. Prior 2026-10-05 run reported `npm test`: 240 total, 184 passed, 56 DB-dependent skipped; a full integration run was not clean in one pass, though an isolated Shopify auth rerun passed; build passed then. **No fresh test run or real-account/mobile browser run is claimed for this document.** Run current tests after branch reconciliation and DB setup. Explicitly missing proof: live Meta WABA/ads/calling/Flows, Shopify, Google, Salesforce, HubSpot, Razorpay/Stripe, refresh/revoke, duplicate webhook/retry, concurrent tenant isolation, queue recovery, Chrome/Edge/Firefox/Safari/Android/iOS. Error/empty/loading states exist in components but require browser QA for overflow, focus, touch, table and modal behavior.

Acceptable static technical constants: bounded request sizes, enum/status names, security timeouts, retry caps, API routes and protocol versions when pinned/configurable. **Business-configurable or review-required values:** `lib/platform.js` seed copy (brand/company/contact, public/auth text, retention and AI limit defaults); `app/page.js` fixed nav labels/footer structure and pricing display cadence; `lib/public-site.js` fixed section/block/layout/link schema; `db/public-site.sql` seed section content; `lib/feature-controls.js` fixed feature catalog; `lib/ai-support.js` default business tone/prompt policy; `lib/ai-actions.js` action allowlist; provider-scoped API versions/currency/region assumptions. Do not remove legitimate safety constants merely to eliminate literals. Plans/prices/feature overrides are database/admin controlled once configured; initial seed/env values still need operator review. Search for further tenant-specific strings and ensure no sample analytics or fake success paths reach production.

## 12. Environment and VPS deployment

`.env.example` is the source for **names**, never values. Groups: database (`DATABASE_URL`, `DATABASE_MIGRATION_URL`, SSL variables); auth/security (`AUTH_SECRET`, previous rotation key, `CSRF_SECRET`, `ENCRYPTION_KEY`, `APP_URL`, origins, rate limits, Super Admin secrets); email (`RESEND_API_KEY`, `EMAIL_FROM`, verification flag); Meta (`META_APP_ID`, `META_APP_SECRET`, Embedded Signup/coexistence config IDs, Graph version, portfolio/system-user token, WABA/phone fallback IDs, webhook verify/signature flags); worker (`JOB_RUNNER_SECRET`, `JOB_RUNNER_URL`, `JOB_POLL_INTERVAL_MS`, queue limits/lag); AI (`OPENAI_API_KEY`, `OPENAI_MODEL`); OAuth (`SHOPIFY_*`, `GOOGLE_*`, `SALESFORCE_*`, `HUBSPOT_*`); billing (`STRIPE_*`, `RAZORPAY_*`); platform/plan/retention and optional calling TURN configuration. Keep actual values only in secret storage/VPS env; never commit `.env.local` or log tokens.

Prior user-provided VPS evidence (not live-verified now): Ubuntu server at `/var/www/whatsapp-crm`, nginx 1.24 HTTPS reverse proxy for `https://crm.mathstrat-sites.com`, PM2 process `whatsapp-crm` running Next on `127.0.0.1:3000`; production node had Git SHA `6aee790` at the time of that report. `curl http://127.0.0.1:3000/api/health` returned HTTP 503 with `database:ready, worker:stale`. PM2 status showed only the web process, suggesting the separate `npm run worker` was not kept alive then. Current VPS SHA, PM2 processes, database migration version, nginx, TLS, logs, backup status, email sender, environment and actual health are `UNKNOWN - REQUIRES VERIFICATION`. The app has not been deployed as part of creating this file.

Production check sequence for an authorized operator: confirm `git rev-parse --short HEAD`, `git status --short`, `pm2 status`, `pm2 logs --lines 50 --nostream` (redact secrets), `curl -sS -w '\nHTTP %{http_code}\n' http://127.0.0.1:3000/api/health`; verify web **and worker** are managed, startup after reboot, migrations backed up, and signed Meta/provider callbacks. Never paste cookies, auth headers, `.env.local` or full token-bearing logs. Build/deploy only after `production_saas` reconciliation, DB backup, migration rehearsal, build/test, and rollback plan. Do not assume `pm2 save` alone creates a worker process.

## 13. What must be done next

### P0 - blocking production

1. **Reconcile Git safely** (`git`, all dirty files): inventory local diff/untracked work, preserve user changes, compare `main` and `production_saas`, then move intended commits to `production_saas` without destructive commands. Dependency: repository access. Done when clean reviewed branch builds/tests, remote target is correct, and `main` is untouched.
2. **Restore/verify VPS worker and schema health** (`scripts/worker.mjs`, `lib/jobs.js`, `lib/health.js`, migrations): check actual deployment/PM2, run migrations with backup, supervise worker, verify `/api/health` 200 and no failed/stale queue. Requires VPS access and live testing.
3. **Security acceptance for new tenant paths** (`app/api/crm`, availability, webviews, Super Admin CMS, provider callbacks, `db/*sql`): cross-tenant/auth/CSRF/webhook/SSRF tests and exposed-credential rotation. Done when negative tests and secrets review pass. Requires test DB and provider access for callback checks.

### P1 - before claiming production readiness

4. **Meta live acceptance** (onboarding, webhooks, messages, templates, ads, calling, Flows, coexistence): verify current review/permissions, asset access, number/WABA subscriptions, signed event queue and real delivery/status. Requires Meta approvals/eligible assets and live tests. Do not block code improvements while waiting.
5. **Provider integration acceptance** (`lib/shopify-*`, Calendar, Salesforce, HubSpot, payment modules): authorize real test accounts; exercise token expiry/revocation, 429/timeout, duplicate events, conflicts, refund and cancellation. Completion is event-backed state consistency, not an HTTP 200 alone. Requires external accounts/sandboxes.
6. **AI/automation safety and load** (`lib/ai-*`, `lib/automation*`, worker): evaluate grounded responses, malicious input, opt-in/cap, human review, retries, unknown send, concurrent claims, cost and alerts. Requires OpenAI test key and Meta test number.
7. **Deployment operations**: backup/restore drill, schema rollback, monitoring/alerting for worker/webhook lag, log redaction and rate-limit/load tests. Requires VPS/DB/operator access.

### P2 - advanced product completion

8. **Broaden CRM object sync deliberately** (`lib/crm-objects.js`, provider connectors): only add Account/Opportunity/Company/Deal outbound writes where business rules/field mappings/conflicts are specified; test full provider cycles. Requires provider scopes and sandbox.
9. **Finish transactional native Flow/commerce journeys** (`lib/flow-runtime.js`, `lib/calendar-fulfillment.js`, `lib/shopify-drafts.js`, payment ledger): handle external reservations/order/payment compensation and truly confirmed status; test actual WhatsApp clients. Requires Meta and commerce accounts.
10. **Improve public CMS and brand controls** (`lib/public-site.js`, `components/public-site-editor.js`, `app/page.js`): operator-approved content, flexible nav/footer/social/inline links/images, preview and accessibility while preserving safe validation and publish semantics. Requires Super Admin review, no Meta approval.

### P3 - optimization

11. **Cross-device UX and scale** (`components/*`, `app/*`, Playwright): full browser/mobile workflows, a11y, inbox/campaign pagination and large data; fix measured issues. Requires device/browser test infrastructure.
12. **Analytics and AI ad advice quality** (`lib/whatsapp-journey-analytics.js`, `lib/whatsapp-ad-advice.js`): reconcile event-based funnel/revenue, measure advice outcome and add guarded approval for changes only when supported by Meta/asset access.

Recommended sequence: (1) read this file and verify Git; (2) preserve/migrate dirty work to `production_saas`; (3) run migration/build/unit/integration tests; (4) fix tenant/security and worker health; (5) perform Meta/provider sandbox acceptance; (6) finish transactional consistency and admin controls; (7) run browser/mobile/load/a11y checks; (8) deploy with backup/rollback and monitor. Revisit priorities after observing actual VPS state.

## Rules for future AI agents

Read this document **and the code** before edits. Verify `git branch`, `git status`, remotes and diff first. Continue production SaaS work only on `production_saas`; never modify/push/merge `main` without explicit instruction. Do not destroy or overwrite dirty user work. Do not delete working behavior or replace it unnecessarily. No hardcoded customer/business values, secrets, fake production data or mock success. Keep platform administration Super Admin-only and tenant data isolated. A UI route, permission request, Shopify draft or untested provider path is not a completed transaction. Implement incrementally, test failure/retry/duplicate cases, and update this file whenever branch, architecture, feature or deployment status materially changes. Avoid claiming zero production gaps or full AiSensy parity without evidence.

## Current project snapshot

| Field | Snapshot |
| --- | --- |
| Project | WhatsApp Growth Desk, web-only WhatsApp CRM SaaS |
| Branch | Currently dirty `main`; future work must use `production_saas` after safe reconciliation |
| Repository | `https://github.com/Pubgmad/whatsapp_tool_crm.git` |
| Stack / DB | Next.js 16 + React 19 + Node + PostgreSQL/RLS |
| Deployment | Prior VPS/nginx/PM2 at `crm.mathstrat-sites.com`; current state UNKNOWN |
| WhatsApp / Meta | Broad Cloud API/Signup/webhook/Flow/ads/calling code; approval and live state UNKNOWN |
| CRM / AI / automation | Substantial implementation; advanced/live workflows PARTIAL/UNTESTED |
| Integrations | Shopify, Google, Salesforce, HubSpot, Razorpay/Stripe code; latest files uncommitted, live verification absent |
| Super Admin / website | Distinct Super Admin and database CMS/brand assets; product depth PARTIAL |
| AiSensy parity | Not established; capability matrix above is a benchmark, not a certification |
| Critical gaps | Git reconciliation, stale-worker/VPS verification, migrations, tenant/security and provider acceptance |
| Next priority | Preserve local work; reconcile to `production_saas`; verify build/DB/worker before deployment |

Handoff: This is a real, expanding multi-tenant WhatsApp SaaS codebase, not a demo, with many advanced modules present in the local checkout. Its operational truth is unresolved: the checkout is dirty on `main`, `production_saas` diverges, the last reported VPS health had a stale worker, and Meta/provider functionality has not been proven end to end. Preserve the current work, move development to `production_saas` intentionally, then verify database, tenant security, worker and provider flows before promising production readiness.
