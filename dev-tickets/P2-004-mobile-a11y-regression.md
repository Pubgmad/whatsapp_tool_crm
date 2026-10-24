# P2-004 — Mobile and accessibility regression

**Status:** QA (CI matrix green locally) — [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md) § P2-004  
**Priority:** P2  
**Type:** QA  

## Context

UX overhaul updated nav labels, focus styles, and responsive CSS. Full matrix not re-run on every route. Production hub tracks optional attestations:

- `slo_certification_last_run`
- `a11y_e2e_last_run` — run `npm run test:e2e` + `node scripts/record-a11y-e2e.mjs`

## Scope

1. Manual pass: Inbox, WhatsApp setup, Billing, Ads, Automation on mobile widths
2. Keyboard / screen reader spot-check on auth + workspace shell
3. Record a11y e2e attestation in Super Admin when green
4. Fix blocking issues on `feature/dev`

## Acceptance criteria

- [x] CI subset: `npm run test:e2e:ci` (chromium a11y-public + android workspace-mobile) — 2026-10-23
- [ ] Full `npm run test:e2e` (firefox, webkit, iphone) on VPS or after `npx playwright install`
- [x] Mobile spec aligned to product switcher + Communication sections nav (Free plan: Automation/Analytics, not Broadcasting)
- [x] Local attestation: `node scripts/record-a11y-e2e.mjs --projects chromium-desktop,android`
- [ ] No critical a11y violations on primary journeys (manual spot-check still optional)

## References

- `CONTEXT.md` P2 item 14
- `tests/e2e/` (workspace-mobile, etc.)
- `lib/production-pending-report.js` — a11y_cert, slo_cert
