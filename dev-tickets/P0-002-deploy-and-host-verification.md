# P0-002 — Deploy and host verification

**Status:** Ops — [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md) § P0-002  
**Priority:** P0  
**Type:** Ops  

## Context

Code audit fixes (inbox hard refresh, workspace navigation, Free Forever seed) are on `main` / merged `production_saas`. **Git:** at ticket creation, `origin/main` and `origin/production_saas` had **no diverging commits** — but **live host commit SHA was not verified**.

Production URL: https://crm.mathstrat-sites.com  

## Verification checklist

1. **Deploy revision:** SSH or deploy panel — confirm running build matches latest `main` (or intended tag)
2. **`npm run db:init`** on production DB after deploy (migrations, Free Forever plan, RLS grants)
3. **Smoke routes** (`CONTEXT.md` §9):
   - Sign in → public `/` or workspace per product rules
   - Open workspace → `/app/settings/whatsapp`
   - Hard refresh `/app/inbox` (must not show “Unable to load this page”)
   - `/app/ads`, `/pricing` shows Free Forever
4. **Meta:** webhook test message to `/api/webhooks/meta`
5. Document result (date, commit SHA, operator) in Super Admin or internal runbook

## Acceptance criteria

- [ ] Recorded production commit SHA matches intended release
- [ ] Inbox hard-load passes on production
- [ ] `db:init` run post-deploy with no duplicate-WABA errors unresolved

## References

- `CONTEXT.md` §9 Deploy checklist
- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` §A inbox fix, §D priorities 1–3
