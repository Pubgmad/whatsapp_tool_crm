# MathStrat WhatsApp CRM — Project Context

Last updated: 2026-10-21 (Ocean Blue premium visual system)  
Primary branch: `production_saas` (merge to `main` after verification)  
Public site / app: `https://crm.mathstrat-sites.com`

This document is the living architecture and go-live checklist for operators, Super Admins, and developers. It describes what the codebase does today, what Meta/other approvals are required, and what engineering work remains.

---

## 1. Product summary

MathStrat is a multi-tenant WhatsApp Business CRM (Next.js App Router + PostgreSQL) with:

- Shared Inbox, templates, broadcasts, automation, CTWA ads, calling, Flows, commerce, AI agents
- Public marketing site (CMS-driven)
- Super Admin platform console (plans, CMS, companies, feature flags)
- Razorpay for SaaS subscriptions; Meta Cloud API for messaging

Tenant isolation is enforced via `business_id` + RLS-oriented DB access patterns.

---

## 2. Architecture (high level)

| Layer | Location | Role |
|---|---|---|
| Public marketing | `app/`, `lib/cms-document.js`, `lib/marketing-page.js` | CMS pages, pricing, CTAs |
| Auth | `lib/auth.js`, `lib/auth-return.js`, Google OAuth | Sessions, Free Forever provisioning |
| CRM shell | `components/workspace-app.js`, `components/workspace/nav-config.js` | Sidebar + feature screens |
| WhatsApp Meta | `lib/meta-*.js`, Embedded Signup APIs | Connection, webhooks, templates |
| Ads / CTWA | `lib/whatsapp-ads.js`, `lib/ads-meta-oauth.js` | Ad account OAuth + campaigns |
| Billing | `lib/billing.js`, `lib/razorpay-billing.js`, `lib/default-plans.js` | Plans + Razorpay |
| Worker | `scripts/worker.mjs` | Campaigns, webhooks, sync jobs |
| Super Admin | `components/super-admin-app.js`, `app/super-admin/*` | Platform configuration |

### Navigation principles (current)

- **No customer-facing dashboard sidebar.** CRM uses a compact **product switcher** + feature secondary tabs (`productShell` in `workspace-app.js`).
- **`/app/dashboard`** redirects to **`/app/settings/whatsapp`** (compatibility only).
- Marketing **Connect WhatsApp** → `/app/settings/whatsapp` (Meta Embedded Signup). No “Account” header button; compact Menu for security / sign out.
- **Create workspace** → `/signup` → Meta setup (`DEFAULT_WORKSPACE_PATH`).
- Normal **Sign in** (no `?next=`) → public root `/`.
- Feature CTAs preserve destination (e.g. CTWA → `/app/ads`).
- Light-first theme init forces `data-theme=light`.

### Visual system (Ocean Blue)

- **Palette:** Ocean Blue `#2563EB` (brand), Deep Indigo `#4338CA` (sparing kickers/accents), Teal `#0D9488` (accent). Light surfaces `#F8FAFC` / `#FFFFFF` / soft `#F1F5F9` (neutral — not blue); ink `#0F172A`, muted `#64748B`, line `#E2E8F0`. Brand soft `#DBEAFE`; blue-soft `#EFF6FF` for brand-tinted chips only.
- **Tokens live in** `app/globals.css`; overrides win via `app/premium-design-system.css` (imported last in `app/layout.js`).
- **Type:** Product + marketing headings use **Plus Jakarta Sans**; body **Source Sans 3** (Linear/Stripe-style sans, not Fraunces).
- **Feature identity (CSS only):** left accent / kicker — inbox & billing → brand; automation → indigo; Meta setup & campaigns → teal.
- Auth shells use light Ocean Blue + teal radials (no purple/orange).

### Feature → route map

| Feature | Route |
|---|---|
| Workspace / Meta setup | `/app/settings/whatsapp` |
| Inbox | `/app/inbox` |
| Calling | `/app/calling` |
| Broadcasting | `/app/campaigns` |
| Templates | `/app/templates` |
| CTWA Ads | `/app/ads` |
| Automation | `/app/automations` |
| AI Agents | `/app/ai-agents` |
| Flows | `/app/settings/whatsapp/flows` |
| Audience / Contacts | `/app/contacts` |
| Analytics | `/app/analytics` |
| Commerce | `/app/commerce` |
| Integrations | `/app/settings/integrations` |
| Billing | `/app/settings/billing` |
| Team | `/app/team` |
| Security | `/app/settings/security` |

---

## 3. Billing & subscription lifecycle (factual)

### Storage

- Global catalogue: `subscription_plans` (`visible`, `is_active`, limits, prices)
- Per workspace: `business_subscriptions` (1:1 with `business_id`)

### Defaults

- `lib/default-plans.js` + `npm run db:init` seed **Free Forever** (`code: free`, ₹0, visible).
- Paid drafts: **starter / growth / professional / enterprise** (hidden, ₹0 until Super Admin prices). Proposed reference INR: 999 / 2499 / 5999 / custom — not live charges.
- `plan.features` may mix **entitlement keys** (`inbox`, `campaigns`, …) and marketing bullets. `planAllowsFeature` only gates on known `WORKSPACE_FEATURES` keys; marketing-only arrays do not deny features.
- Signup / Google signup assigns Free Forever as **`active`** with **no trial expiry** when the free plan exists.
- Env: `DEFAULT_SUBSCRIPTION_PLAN_CODE=free` (recommended).

### Enforcement

- `assertSubscriptionActive` + usage limits in `lib/limits.js` (when `SUBSCRIPTION_ENFORCEMENT_ENABLED` is true).
- Feature keys: `assertWorkspaceFeature` / `workspaceFeatureFlags` in `lib/feature-controls.js`.
- Paid upgrades: Razorpay checkout / portal / webhooks (`/api/webhooks/razorpay`). Activation requires verified payment webhook — not success-URL alone.
- Public `/pricing` reads `is_active AND visible` plans only; UI shows marketing bullets only (keys filtered).

### Separated charges

Platform subscription ≠ Meta WhatsApp messaging fees ≠ optional AI / seats / ad credits.

---

## 4. Meta approvals & configuration (required for production)

Meta items use **exact product / permission names** as used in Meta developer tooling and this repo.

### 4.1 Meta app & WhatsApp product (platform)

| Item | Exact name / what to configure | Why |
|---|---|---|
| Meta App | Meta Developer App (`META_APP_ID`, `META_APP_SECRET`) | All Graph API / Embedded Signup |
| WhatsApp product | **WhatsApp** product on the Meta App | Cloud API messaging |
| Embedded Signup | **Embedded Signup** / Facebook Login for Business config (`META_EMBEDDED_SIGNUP_CONFIG_ID` or equivalent) | Customer Connect WhatsApp |
| Webhook | WhatsApp webhook callback URL + verify token | Inbound messages & statuses |
| Graph API version | Controlled via operational policy / env | Compatibility |

### 4.2 Core messaging scopes (workspace connection)

Required after Embedded Signup / token exchange (`lib/meta-onboarding.js`, `lib/meta-health.js`):

| Permission (scope) | Purpose |
|---|---|
| **`whatsapp_business_management`** | Manage WABA assets, phones, templates |
| **`whatsapp_business_messaging`** | Send/receive WhatsApp messages |

These typically need **App Review → Advanced Access** for production customers beyond test/dev assets.

### 4.3 Click-to-WhatsApp Ads (CTWA)

OAuth scopes requested in `lib/ads-meta-oauth.js` (`ADS_REQUIRED_SCOPES`):

| Permission (scope) | Purpose |
|---|---|
| **`ads_management`** | Create/manage ad campaigns |
| **`ads_read`** | Read campaign / insights |
| **`pages_show_list`** | List Facebook Pages |
| **`pages_read_engagement`** | Page engagement data |
| **`pages_manage_metadata`** | Page metadata / subscriptions |
| **`pages_manage_ads`** | Ads linked to Pages |
| **`leads_retrieval`** | Lead form lead sync |
| **`business_management`** | Business / ad account asset access |

Also required operationally:

- Linked **Facebook Page** + **Ad Account** + WhatsApp number
- Meta **App Review** for production ads/lead permissions beyond development mode
- Optional prepaid **ad credits** flows (separate from WhatsApp conversation credits)

### 4.4 Templates

| Item | Notes |
|---|---|
| **Message Templates** | Created/synced in CRM; **approved inside Meta Business Manager / WhatsApp Manager** |
| Categories | Marketing / Utility / Authentication — Meta pricing & policy apply |

### 4.5 WhatsApp Calling

| Item | Notes |
|---|---|
| Calling APIs / entitlement | Meta eligibility + enable calling on the phone (`metadata.calling.status === ENABLED` after refresh) |
| **TURN / relay** | Platform env `WHATSAPP_CALL_TURN_URLS` (comma-separated `turn:` / `turns:` URLs) + `WHATSAPP_CALL_TURN_SECRET` (HMAC for short-lived credentials). Without both, API returns `CALL_RELAY_NOT_CONFIGURED` and Production hub shows calling as **setup**, not **available**. |
| Workspace UI | `/app/calling` shows an honest blocked reason (TURN → Meta enablement → role policy). Use **Load settings** to sync Meta calling flags. |
| Production checklist | Meta Setup → Capabilities treats calling as ready only when **Meta + TURN** are both satisfied. |

### 4.6 WhatsApp Groups

| Item | Notes |
|---|---|
| Groups messaging entitlement | Meta **AVAILABLE** status + feature flag; default-off until eligible |

### 4.7 Commerce / catalogs (when used)

| Item | Notes |
|---|---|
| WhatsApp **Catalog** / Commerce | Meta catalog linkage; payments may use Razorpay merchant path (INR-oriented) |

### 4.8 Webhooks & security

| Item | Notes |
|---|---|
| Webhook signature verification | Must verify with app secret in production (fail-closed) |
| Phone number registration | Cloud API or **coexistence** (Business App) paths |

---

## 5. Other provider approvals / configuration

| Provider | Exact setup | Purpose |
|---|---|---|
| **Razorpay** | Platform keys + `razorpay_subscription_total_count` setting; webhook | SaaS plan checkout / renewals |
| **Razorpay (merchant)** | Per-tenant merchant credentials | In-chat commerce payments |
| **OpenAI** (or configured LLM) | `OPENAI_*` env | AI Agents drafts / auto-reply |
| **Shopify** | `SHOPIFY_CLIENT_*`, feature `connectors` | Order / checkout WhatsApp ops |
| **WooCommerce** | Store URL + signed webhooks | Order events |
| **Salesforce** | `SALESFORCE_CLIENT_*`, feature `crm_sync` | CRM sync |
| **HubSpot** | `HUBSPOT_CLIENT_*`, feature `crm_sync` | CRM sync |
| **Google** | `GOOGLE_CLIENT_*` | Login and/or Calendar booking |
| **Dialogflow CX** | Service account JSON | Intent bots |
| **TURN server** | Relay credentials | WhatsApp Calling WebRTC |

---

## 6. Super Admin controls (no code deploy needed)

Via `/super-admin` (single platform Super Admin — not per-tenant admin):

- CMS: pages, navigation, footer, SEO, media
- Plans: create/edit/publish (`visible` / `is_active`), limits, features JSON
- Companies / workspaces oversight
- Feature flags / platform settings
- Privacy policy versions
- Operational copy (signin/signup labels, pricing heading)

Do **not** overwrite admin-edited CMS with deploy-time hard resets without an explicit Reset + Publish flow.

---

## 7. Code / product development still required

Prioritized engineering backlog (not Meta App Review itself):

### P0 — Operations / reliability

1. Ensure production runs **`scripts/worker.mjs`** (campaigns, webhooks, sync stall without it).
2. Deploy HEAD that includes inbox + dashboard/workspace navigation fixes; run **`npm run db:init`** so Free Forever exists.
3. Enforce Super Admin MFA + privileged DB role fail-closed in production.
4. Always verify Meta webhook signatures in production.

### P1 — Product completeness

5. Campaign **drip** advance gated on Meta **delivery** confirmation (not enqueue-only).
6. Automation: AI simulate vs runtime parity; surface Flow resume errors.
7. Inbox: media send in composer; stronger concurrency/optimistic UI (as needed).
8. Calling: production TURN + Meta calling entitlement verification.
9. CTWA: live ads spend activation only after Meta App Review + connected assets; keep paused-create safe by default.
10. Groups: keep gated until Meta entitlement is AVAILABLE.

### P2 — Commercial / UX polish

11. Super Admin publishes paid plan prices only after commercial approval (do not copy AiSensy rates).
12. Billing UI: invoices history if/when Razorpay provides them; messaging-rate disclosure remains CMS-managed.
13. CMS: ensure production CMS published after defaults upgrades (Reset → review → Publish).
14. Mobile / a11y regression on Inbox, Workspace setup, Billing.

### Explicit non-goals

- Do not invent Meta approvals or claim live ads without scopes.
- Do not force Billing after Free Forever signup.
- Do not restore a generic all-features dashboard as the default CRM home.

---

## 8. Recent root-cause fixes (reference)

| Problem | Root cause | Fix |
|---|---|---|
| Post-auth felt like Billing | Marketing **Account** CTA → `/app/settings/billing` | Account → security; Open workspace → Meta setup |
| Empty pricing | No plan seed without `SUBSCRIPTION_PLANS_JSON` | Free Forever seed + hidden paid drafts |
| Free users blocked | `trialing` with `trial_days=0` expired immediately | Free → `active`, null period end |
| Open workspace → Inbox | `DEFAULT_WORKSPACE_PATH=/app/inbox` | Now `/app/settings/whatsapp` |
| Generic dashboard | Overview nav + `/app/dashboard` | Removed from nav; dashboard redirects to Workspace |
| Inbox “Unable to load this page” | (1) slim inbox API missing `setup`; (2) `suggestionContext.messageId` when null; (3) parent shell `state.conversations.find` when non-array | Full `loadState` + null-safe suggestion guards + `asArray` / `mergeWorkspaceState` hardening; Contact360/Groups optional chaining |
| Automation looked like a dashboard | KPI hero + Connection readiness + Inbox journey strip | Workflow-first topbar + canvas; readiness/connections demoted to `<details>`; remove Automation→Inbox journey |
| Plan features locked everything | Marketing strings in `plan.features` failed `planAllowsFeature` | Entitlement keys only; marketing bullets ignored for gating |

---

## 9. Deploy checklist

1. Merge/push `production_saas` → `main`.
2. Deploy app + worker.
3. `npm run db:init` on production DB.
4. Confirm env: `META_APP_*`, webhook secrets, `DATABASE_URL`, Razorpay, `DEFAULT_SUBSCRIPTION_PLAN_CODE=free`.
5. Smoke: Sign in → `/`; Open workspace → `/app/settings/whatsapp`; `/app/inbox` loads; `/app/ads` dedicated; `/pricing` shows Free Forever.
6. Meta: Embedded Signup smoke on a test WABA; webhook receive test.

---

## 10. Related docs in repo

- `README.md` — setup / env overview
- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` — module readiness matrix
- `docs/UX_CLEANUP_REPORT.txt` — UX cleanup notes
- `lib/default-plans.js` — Free Forever + draft tiers
- `lib/pricing-architecture.js` — charge-layer copy (draft commercial policy)
