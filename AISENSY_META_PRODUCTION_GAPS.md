# AiSensy, Meta WhatsApp, and production gap reference

Updated: 2026-10-07. This is an operator and engineering checklist—not a certification that every row is complete in production.

## Production foundation (must be true on VPS)

| Gap | Status in code | What to verify live |
| --- | --- | --- |
| Git branch hygiene (`production_saas`, clean deploy) | Process | Correct branch, no accidental `main` deploy |
| PostgreSQL migrations applied atomically | `npm run db:init` | Schema matches app; backup before migrate |
| **Worker** always running (`npm run worker`) | Implemented | `/api/health` 200, not `worker:stale` |
| Runtime DB role without BYPASSRLS | Health check | App user is not superuser |
| Razorpay SaaS webhooks | Razorpay-only billing | `/api/webhooks/razorpay`, cycle count in Super Admin |
| Cross-tenant security on new routes | RLS + tests (partial) | Adversarial tests on CRM/availability/webviews |
| Backups, alerting, log redaction | Ops | Not automated in app |

## Super Admin controls (implemented in app)

- **17 workspace feature toggles** (global + per company): inbox, templates, segments, flows, entry points, campaigns (+ retry failed), automation, commerce, ads, calling, conversions, connectors, checkout recovery, AI drafts, AI auto-reply, webviews, CRM sync.
- **Platform operations** dashboard: worker, Razorpay config, Meta webhook queue, RLS role, calendar backlog.
- **Company list**: sort **Needs attention** (failed webhooks + campaign jobs + AI review queue).
- **Company drawer**: tenant operations + **Meta / WhatsApp gaps** (from `CAPABILITY_DEFINITIONS` in `lib/whatsapp-operations.js`).

---

## AiSensy features — present vs missing

| AiSensy marketing feature | Your CRM | Missing or needs improvement |
| --- | --- | --- |
| AI WhatsApp agents (fully autonomous) | Drafts, capped auto-reply, owner-approved actions | **Autonomous** agent parity, evals, abuse/cost controls at scale |
| Unlimited broadcasts | Campaign worker + templates | **Volume** SLOs, 429 handling, timezone scale proof |
| Failed broadcast retry | **Retry failed** on campaigns | Live proof; not all error types retryable |
| Chatbot flow builder | Automation + advanced nodes | Complex branch/replay/load tests |
| WhatsApp Forms (Flows) | Flow design/runtime/crypto | **Conditional** graph compiler; per-step funnel |
| WhatsApp Payments in-chat | Native + Razorpay merchant | Region/PSP eligibility; ledger vs hosted link |
| Multi-agent live chat | Inbox + support policy | SLA, concurrent assignment, mobile QA |
| CTWA ads | `whatsapp-ads.js` | Live Marketing API + assets + App Review |
| AI Ads Manager (self-optimizing) | Read-only advice | Experiment loop and guarded changes |
| Webviews in-chat | Hosted `/w/[viewId]` | **Not** proven as in-chat webview |
| Carousel / catalog cards | Advanced templates + commerce | Per-WABA approval and live send matrix |
| Smart segmentation + click retargeting | Segments + click tracking | Click = continue action, not raw CTA tap |
| Scheduler / timezone broadcasts | Campaign schedule fields | Live timezone acceptance |
| Shopify / Woo + cart recovery | Connectors + recovery job | Paid order reconciliation on live store |
| HubSpot / Salesforce breadth | Contact/lead sync + read objects | Full bidirectional Account/Opp/Deal |
| Dialogflow / no-code bot bridge | — | **Not implemented** |
| 2000+ integrations marketplace | Workspace webhooks + API keys | No Zapier-style catalog |
| Free WABA onboarding story | Embedded Signup + coexistence | Your Meta app review and ops, not AiSensy’s |

---

## Meta / WhatsApp-specific capabilities

Tracked in workspace **Meta Setup → capabilities** (`CAPABILITY_DEFINITIONS`). “Missing” means status `setup` until inferred or configured.

| Capability key | WhatsApp / Meta product | Typically requires |
| --- | --- | --- |
| `cloud_api` | Cloud API messaging | Connected WABA, registered phone, valid token |
| `webhooks` | Inbound messages/status | WABA subscribed fields, `messages`, signatures |
| `templates` | Template CRUD/sync | `whatsapp_business_management`, approved templates |
| `interactive_messages` | Lists, buttons | 24h session + Cloud API |
| `native_flows` | WhatsApp Flows | Published Flow, encryption endpoint if data exchange |
| `authentication_templates` | OTP templates | AUTHENTICATION category approved |
| `media_templates` | Media headers | Approved media template + handles |
| `coexistence` | Business App + API | Coexistence entitlement + sync |
| `catalogs` | Catalog commerce | Catalog linked to WABA, commerce permissions |
| `ctwa` | Click-to-WhatsApp ads | Ad account, Page, `ads_management`, Marketing API tier |
| `marketing_messages_api` | Marketing Messages API | WABA `ONBOARDED` MM API status |
| `calling` | WhatsApp Calling | Eligible number, calling webhooks, WebRTC |
| `billing_visibility` | Credit line visibility | Business management + credit line access |

### Common Meta **permissions** (app-level, not automatic)

- `whatsapp_business_messaging`, `whatsapp_business_management` — core CRM.
- `business_management` — portfolio/assets.
- `ads_management`, `ads_read`, `pages_*` — CTWA and reporting.
- Marketing API access tier — ads create/report at scale.

**Request ≠ approval.** Super Admin should treat App Review and WABA asset state as external gates.

### Post-approval workspace activation (implemented)

After Embedded Signup or manual WABA connection, use **Meta Setup → Capabilities → Refresh entitlements** (or wait for the automatic refresh on signup). This syncs phone numbers, Marketing Messages API status, product catalogs, calling settings, commerce flags, Flow library, templates, and repairs webhook subscription where possible.

### Product areas with code but **live Meta proof still open**

- Coexistence history import completeness  
- Native in-chat **payments** (region-specific)  
- **Calling** on eligible production numbers  
- **Flows** encrypted data exchange on public HTTPS URL  
- **Commerce** catalog sync and order lifecycle with Meta  
- **Marketing Messages API** campaigns end-to-end  
- Ads create/edit with real ad account  

---

## What still needs improvement (priority)

1. **P0**: Worker + health + migrations on production VPS.  
2. **P0**: Live Meta sandbox: send/receive, template, webhook queue, one Flow, one campaign.  
3. **P1**: Inbox scale + mobile browsers.  
4. **P1**: Shopify/Calendar/CRM OAuth acceptance on real sandboxes.  
5. **P2**: Flow conditional compiler, webview client proof, Dialogflow only if product requires it.  
6. **P2**: Public CMS depth (nav, social, inline links) if marketing site parity matters.

---

## Code map (quick)

| Area | Primary modules |
| --- | --- |
| Feature gates | `lib/feature-controls.js`, `/api/*` wrappers |
| Meta capabilities | `lib/whatsapp-operations.js` |
| Tenant ops | `lib/tenant-operations.js`, Super Admin company APIs |
| Campaign retry | `lib/campaign-controls.js` → `retry_failed` |
| Billing | `lib/razorpay-billing.js`, `lib/billing.js` |

Re-run `npm test` and `npm run build` after deploy; exercise Super Admin **Features**, **Companies → Needs attention**, and company **Meta / WhatsApp gaps**.
