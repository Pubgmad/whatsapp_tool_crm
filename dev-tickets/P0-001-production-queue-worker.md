# P0-001 — Production queue worker

**Status:** Ops — [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md) § P0-001  
**Priority:** P0  
**Type:** Ops  

## Context

The web process does **not** continuously process campaign queues, automations, webhooks backlog, audience tag jobs, or retention. `README.md` and `CONTEXT.md` require a second process: `npm run worker` (see `ecosystem.config.cjs` → `whatsapp-crm-worker`).

Without worker: campaigns stall, automations delay, `GET /api/health` may return **503** (stale worker heartbeat).

## Tasks

1. On VPS: `pm2 start ecosystem.config.cjs --only whatsapp-crm-worker` (or equivalent) with same `.env` as web app
2. Confirm `JOB_RUNNER_SECRET`, `JOB_RUNNER_URL=http://127.0.0.1:3000` match web
3. Verify heartbeat: `curl -fsS https://crm.mathstrat-sites.com/api/health`
4. Workspace **Production hub** → “Background worker” should show **ready**

## Acceptance criteria

- [ ] Exactly one worker instance (unless capacity-tested for more)
- [ ] Health endpoint 200 with recent worker cycle
- [ ] Test campaign or automation job completes end-to-end on production tenant

## References

- `scripts/worker.mjs`
- `lib/production-pending-report.js` (`worker` item)
- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` §B Platform / Worker
