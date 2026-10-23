# Dev tickets — MathStrat WhatsApp CRM

**Branch:** `feature/dev` (local only until GitHub write access)  
**Repo:** `whatsapp_tool_crm`  
**Ops runbook:** [docs/PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md)  
**Production:** https://crm.mathstrat-sites.com  

## Status summary (2026-10-23)

| ID | Status | Notes |
|----|--------|--------|
| DEV-001 | **Done** | ThemeToggle login fix |
| DEV-002 | **Done** | `db:seed` loads `.env.local` |
| P0-001 | **Ops** | Worker — runbook § P0-001 |
| P0-002 | **Ops** | Deploy verify — runbook § P0-002 |
| P0-003 | **Ops** | MFA + RLS — runbook § P0-003; hub surfaces gaps in production |
| P0-004 | **Done (code)** | Prod fail-closed signatures; runbook § P0-004 |
| P1-001 | **Done** | Drip delivery gate |
| P1-002 | **Done** | Automation parity + flow errors |
| P1-003 | **Done** | Inbox media composer |
| P1-004 | **Done (code)** | Hub/readiness + TURN docs; **ops:** set TURN on VPS |
| P1-005 | **Blocked (Meta)** | App Review + ad account; runbook § P1-005 |
| P1-006 | **Done** | Coexistence UI + sync; README updated |
| P2-001 | **Blocked (commercial)** | Super Admin publishes prices after approval |
| P2-002 | **Done** | `GET /api/billing/invoices` + Billing UI |
| P2-003 | **Ops** | CMS republish — runbook § P2-003 |
| P2-004 | **QA** | CI matrix green locally (`npm run test:e2e:ci`); full 5-browser `npm run test:e2e` + VPS attestation — runbook § P2-004 |
| OPS-001 | **Ops** | Google OAuth — runbook § OPS-001 |
| OPS-002 | **Ops** | Credentials matrix — runbook § OPS-002 |

## Index

| ID | Priority | Title | Type |
|----|----------|-------|------|
| [DEV-001](./DEV-001-theme-toggle-login-fix.md) | P0 | ThemeToggle import on login | **Done** |
| [P0-001](./P0-001-production-queue-worker.md) | P0 | Production queue worker | Ops |
| [P0-002](./P0-002-deploy-and-host-verification.md) | P0 | Deploy + host verification | Ops |
| [P0-003](./P0-003-super-admin-mfa-and-db-rls.md) | P0 | Super Admin MFA + DB RLS fail-closed | Security |
| [P0-004](./P0-004-meta-webhook-signature-enforcement.md) | P0 | Meta webhook signatures in prod | Security |
| [P1-001](./P1-001-campaign-drip-delivery-gated.md) | P1 | Campaign drip: delivery-gated advance | **Done** |
| [P1-002](./P1-002-automation-ai-and-flow-errors.md) | P1 | Automation AI parity + Flow resume errors | **Done** |
| [P1-003](./P1-003-inbox-media-composer.md) | P1 | Inbox composer media send | **Done** |
| [P1-004](./P1-004-calling-turn-and-entitlement.md) | P1 | Calling: TURN + Meta entitlement | **Done (code)** |
| [P1-005](./P1-005-ctwa-live-activation.md) | P1 | CTWA live ads activation | Meta + ops |
| [P1-006](./P1-006-coexistence-onboarding.md) | P1 | Coexistence onboarding + history sync | **Done** |
| [P2-001](./P2-001-paid-plan-pricing.md) | P2 | Publish paid plan prices | Commercial |
| [P2-002](./P2-002-billing-invoice-history.md) | P2 | Billing invoice history (Razorpay) | **Done** |
| [P2-003](./P2-003-cms-republish-production.md) | P2 | CMS republish on production DB | Ops |
| [P2-004](./P2-004-mobile-a11y-regression.md) | P2 | Mobile / a11y regression pass | QA |
| [OPS-001](./OPS-001-google-login-oauth.md) | Ops | Google sign-in OAuth client | Config |
| [OPS-002](./OPS-002-platform-provider-credentials.md) | Ops | Platform env credentials matrix | Config |
| [DEV-002](./DEV-002-db-seed-load-env.md) | DevEx | `db:seed` loads `.env.local` | **Done** |

## Working agreement

- Implement on **`feature/dev`**; keep commits local until collaborator access on `Pubgmad/whatsapp_tool_crm`.
- Ops tickets: execute [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md) on the VPS; evidence in Super Admin notes.
