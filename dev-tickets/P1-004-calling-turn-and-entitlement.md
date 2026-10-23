# P1-004 — WhatsApp Calling: TURN relay + Meta entitlement

**Status:** Done (code) — ops: TURN on VPS per [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md)  
**Priority:** P1  
**Type:** Engineering + infrastructure  

## Context

Browser WebRTC calling is implemented but returns **`CALL_RELAY_NOT_CONFIGURED`** without TURN URLs/secrets (`WHATSAPP_CALL_TURN_URLS`, `WHATSAPP_CALL_TURN_SECRET` in `.env.example`). Meta calling entitlement must be AVAILABLE for the WABA.

## Tasks

1. Provision TURN (or approved relay) and set production env
2. Verify Meta calling capability on test WABA
3. End-to-end test: initiate call from `/app/calling`, handle failure modes in UI
4. Document operator setup in CONTEXT or README

## Acceptance criteria

- [ ] Production env has valid TURN configuration
- [x] Calling UI surfaces TURN / Meta / policy blockers in order
- [x] Production hub / activation checklist: calling **available** only when Meta enabled **and** TURN configured

## References

- `CONTEXT.md` §4.5, P1 item 8
- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` — Calling row
- `components/whatsapp-calling.js`
