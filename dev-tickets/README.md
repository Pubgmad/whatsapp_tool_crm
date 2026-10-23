# Dev tickets — MathStrat WhatsApp CRM

**Branch:** `feature/dev` (from `main`)  
**Repo:** `whatsapp_tool_crm`  
**Sources:** `CONTEXT.md` §7, `docs/INBOX_AND_PRODUCTION_AUDIT.txt`, `README.md`, in-app Production hub / parity APIs  
**Production:** https://crm.mathstrat-sites.com  

## Branch sync (2026-10-23)

| Branch | vs `main` |
|--------|-----------|
| `origin/main` | Local baseline for `feature/dev` |
| `origin/production_saas` | **No commits ahead/behind `main`** at ticket creation time — merges already landed on `main` |
| Live host | **Not verified from this machine** — use [P0-002](./P0-002-deploy-and-host-verification.md) |

## Index

| ID | Priority | Title | Type |
|----|----------|-------|------|
| [DEV-001](./DEV-001-theme-toggle-login-fix.md) | P0 | ThemeToggle import on login | **Done** (local) |
| [P0-001](./P0-001-production-queue-worker.md) | P0 | Production queue worker | Ops |
| [P0-002](./P0-002-deploy-and-host-verification.md) | P0 | Deploy + host verification | Ops |
| [P0-003](./P0-003-super-admin-mfa-and-db-rls.md) | P0 | Super Admin MFA + DB RLS fail-closed | Security |
| [P0-004](./P0-004-meta-webhook-signature-enforcement.md) | P0 | Meta webhook signatures in prod | Security |
| [P1-001](./P1-001-campaign-drip-delivery-gated.md) | P1 | Campaign drip: delivery-gated advance | Engineering |
| [P1-002](./P1-002-automation-ai-and-flow-errors.md) | P1 | Automation AI parity + Flow resume errors | Engineering |
| [P1-003](./P1-003-inbox-media-composer.md) | P1 | Inbox composer media send | Engineering |
| [P1-004](./P1-004-calling-turn-and-entitlement.md) | P1 | Calling: TURN + Meta entitlement | Engineering + infra |
| [P1-005](./P1-005-ctwa-live-activation.md) | P1 | CTWA live ads activation | Meta + ops |
| [P1-006](./P1-006-coexistence-onboarding.md) | P1 | Coexistence onboarding + history sync | Engineering |
| [P2-001](./P2-001-paid-plan-pricing.md) | P2 | Publish paid plan prices | Commercial + Super Admin |
| [P2-002](./P2-002-billing-invoice-history.md) | P2 | Billing invoice history (Razorpay) | Engineering |
| [P2-003](./P2-003-cms-republish-production.md) | P2 | CMS republish on production DB | Super Admin |
| [P2-004](./P2-004-mobile-a11y-regression.md) | P2 | Mobile / a11y regression pass | QA |
| [OPS-001](./OPS-001-google-login-oauth.md) | Ops | Google sign-in OAuth client | Config |
| [OPS-002](./OPS-002-platform-provider-credentials.md) | Ops | Platform env credentials matrix | Config |
| [DEV-002](./DEV-002-db-seed-load-env.md) | DevEx | `db:seed` loads `.env.local` | Engineering |

## Working agreement

- Implement code tickets on **`feature/dev`**; open PRs to `main` when ready.
- Ops tickets may not need code — document evidence in PR or Super Admin notes.
- Meta App Review and merchant OAuth are **customer/platform** work; tickets describe dependencies only.
