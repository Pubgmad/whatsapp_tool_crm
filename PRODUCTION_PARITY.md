# WhatsApp Growth Desk — AiSensy-class production parity (code baseline)

This document states what is **implemented in this repository** for a Meta-enabled WhatsApp CRM comparable to AiSensy-style products. It is the single place to answer “is our CRM complete in code?” before live smoke tests.

## Runbook (every environment)

1. `npm run db:init` — applies `db/schema.sql` and incremental SQL including `db/crm-production-gaps.sql`.
2. Configure `.env` from `.env.example` (Meta, Razorpay, `APP_URL`, worker `JOB_RUNNER_SECRET`, optional OpenAI, HubSpot, Salesforce, Shopify).
3. `npm run build` && `npm start` (app) + `node scripts/worker.mjs` (queues).
4. Post-approval: Meta Setup → **Refresh entitlements** (`refresh_entitlements` on WhatsApp operations).

## Feature matrix (code-complete vs live verification)

| Area | In code | Live verification still required |
|------|---------|----------------------------------|
| Embedded Signup / WABA / numbers / templates sync | Yes (`lib/meta-onboarding.js`, `lib/template-meta-sync.js`, `lib/whatsapp-operations.js`) | Token health, template approval in Meta |
| Campaigns + segments + MM API gate | Yes (`lib/actions.js`, `marketing_messages` feature) | MM API entitlement on WABA |
| Recurring campaigns | Yes (API + UI `recurringIntervalDays`, worker spawn) | Schedule timezone expectations |
| Automation / chatbot flows | Yes + **dry-run simulate** (`/api/automation/simulate`) | End-to-end on real handset |
| AI support + knowledge import + owner-approved actions | Yes | OpenAI quota and policy |
| AI intent routing to agents | Yes (`lib/ai-intent-routing.js`) | Team availability |
| Native Flows compile + branch UI | Yes (`lib/flow-design.js`, flow designer) | Meta Flow publish |
| Transactional webviews | Yes (`app/w/[viewId]`, `lib/whatsapp-webviews.js`) | Public HTTPS `APP_URL` |
| CTWA ads + experiments | Yes (operations + baseline experiments table/API/UI) | Ad account spend |
| Commerce / native payments / Shopify OAuth + ledger reconcile | Yes | Shopify app review, webhooks |
| CRM HubSpot + Salesforce contacts **and** objects | Yes (`lib/crm-objects.js`) | OAuth reconnect |
| **Outbound CRM push** on new WhatsApp contact | Yes (`lib/crm-contact-export.js`, `lib/crm-outbound-context.js` — tenant/WABA company name, WhatsApp conversation gate) | CRM API limits |
| Calling webhooks | Yes (`lib/whatsapp-calling.js`) | Calling product approval |
| Journey analytics + delivery mix | Yes | Report date ranges |
| Super-admin / meta webhook queue / public site | Yes | Ops monitoring |
| Razorpay-only billing | Yes | Live payments |

## Integrations added in code

- **Autonomous AI actions** — optional `action_autonomous_enabled` runs the same approve path as the owner after a proposal (audited as `ai_action_autonomous_approved`).
- **Dialogflow CX** — optional `dialogflow_bot` feature; platform `DIALOGFLOW_PROJECT_ID` + `GOOGLE_DIALOGFLOW_SERVICE_ACCOUNT_JSON`, per-workspace agent ID.
- **In-chat hosted pages** — Meta `cta_url` interactive messages (`send_inchat` / transactional send) open your HTTPS `/w/...` pages inside WhatsApp; native Flow path uses `send_flow`.
- **Production certification** — `GET /api/workspace/production-certification` and `GET /api/whatsapp/operations?certification=1` run live Meta/Shopify/CRM/worker checks (not a Meta legal certification).

## Remaining boundaries

- **Per-screen Flow funnel analytics** — invite/journey level only unless Meta provides screen events in your webhook contract.
- **Meta / Google legal product certification** — your App Review and GCP Dialogflow console setup remain operator responsibilities; this API only reports technical readiness.

## Worker jobs (production)

`POST /api/jobs/process` runs: Meta webhooks, commerce, support, connectors, CRM sync, **CRM outbound push**, campaigns, automation, retention, meta health, integrations.

## Tests

`npm test` — unit/integration coverage including meta activation, CRM, webviews, automation simulate, intent routing, and campaign safety.

When this file and `CRM_PRODUCTION_GAP_STATUS.md` agree with `npm test` passing and `npm run build` succeeding, the **codebase** is production-shaped for AiSensy-class WhatsApp CRM; your remaining work is **environment configuration and live Meta/CRM/Shopify smoke**, not missing core modules.
