# P1-001 — Campaign drip: delivery-gated step advance

**Status:** Done (feature/dev) — run `npm run db:init` on all envs for `awaiting_delivery` status  
**Priority:** P1  
**Type:** Engineering  

## Context

Multi-step **drip sequences** exist (`lib/campaign-drip.js`, Campaigns UI). Audit: steps currently advance after **enqueue**, not after Meta **delivery** (or read) confirmation.

## Scope

1. Define advance trigger: delivered / failed / timeout policy per step
2. Hook into Meta status webhooks or recipient status fields already stored
3. Worker must process drip scheduler without double-sending
4. Tests: unit + integration for delivery-gated transition

## Acceptance criteria

- [ ] Drip step N+1 does not send until step N meets defined delivery rule
- [ ] Failed delivery paths documented (retry vs skip vs pause sequence)
- [ ] `tests/` cover at least one delivery-gated scenario

## References

- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` — Campaign drip row
- `CONTEXT.md` P1 item 5
- `lib/honest-product-limits.js` — campaign_drip boundary
