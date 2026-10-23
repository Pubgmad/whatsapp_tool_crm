# P1-002 — Automation: AI simulate vs runtime parity + Flow resume errors

**Status:** Partial — Flow resume errors surfaced in `automation_sessions.last_error`; AI simulate vs runtime parity still open  
**Priority:** P1  
**Type:** Engineering  

## Context

Automation core is **strong** (flow builder, queue, native Flows). Gaps:

1. **AI route simulate** path may not match **runtime** execution (`lib/automation-ai-router.js`, simulate API vs worker)
2. **Flow resume** errors may be swallowed — operators do not see why a Flow session stalled

## Scope

1. Align simulate output with `automation-node-runtime` behavior (or document intentional differences in UI)
2. Surface Flow resume / runtime errors in Automation live-ops or inbox handoff
3. Add regression tests where simulate ≠ runtime today

## Acceptance criteria

- [ ] Simulate panel result matches worker run for representative flows (document exceptions)
- [ ] User-visible error when Flow resume fails (not silent no-op)
- [ ] No new autonomous AI execution without existing platform gates

## References

- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` — Automation row
- `CONTEXT.md` P1 item 6
- `components/automation-live-ops-panel.js`
