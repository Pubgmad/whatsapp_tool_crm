# P0-003 — Super Admin MFA and database RLS fail-closed

**Status:** Ops — [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md) § P0-003; hub flags MFA/RLS in production  
**Priority:** P0  
**Type:** Security / ops  

## Context

Audit flags:

- Super Admin MFA is **optional** unless enabled
- App DB role may **bypass RLS** if migration grants use superuser-style connection (`DATABASE_URL` vs dedicated `crm_app` role)

`workspaceProductionPending` surfaces **Database tenant isolation** when `platform.database.isolationReady` is false.

## Tasks

1. Enable MFA for Super Admin account(s) in production
2. Remove `SUPER_ADMIN_PASSWORD` from runtime env after init (`README.md`)
3. Configure `DATABASE_URL` with **non-BYPASSRLS** runtime role; use `DATABASE_MIGRATION_URL` only for `db:init`
4. Re-run `db:init` grants; confirm RLS policies active
5. Run `npm test` / integration tests with `TEST_DATABASE_URL` where applicable

## Acceptance criteria

- [ ] Super Admin login requires MFA in production
- [ ] Production hub / platform snapshot shows isolation **ready**
- [ ] No tenant data leakage in spot-check API tests across two workspaces

## References

- `.env.example` (`DATABASE_URL`, `DATABASE_MIGRATION_URL`)
- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` §B Platform, §D item 2
- `README.md` Super Admin / health sections
