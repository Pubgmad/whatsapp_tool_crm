# DEV-002 — `db:seed` should load `.env.local`

**Status:** Done (feature/dev)  
**Priority:** DevEx  
**Type:** Engineering  

## Problem

`npm run db:seed` exits with `DATABASE_URL is required` unless env vars are exported manually. `db:init` uses `@next/env` `loadEnvConfig`; `scripts/db-seed.mjs` does not.

## Proposed fix

Add the same `loadEnvConfig(process.cwd())` call at top of `db-seed.mjs` (and optionally `reviewer-init.mjs` if same gap).

## Acceptance criteria

- [ ] `npm run db:seed` works when only `.env.local` defines `DATABASE_URL`, `SEED_*`
- [ ] No change to production behavior when env is injected by PM2/systemd

## References

- `scripts/db-init.mjs`
- `scripts/db-seed.mjs`
- `sessions.md` local dev notes
