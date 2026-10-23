# P1-006 — Coexistence onboarding + history synchronization

**Status:** Done (implemented; README + runbook updated)  
**Priority:** P1  
**Type:** Engineering (new feature)  

## Context

`README.md` states explicitly:

> This CRM does not yet implement coexistence onboarding or history synchronization.

Meta offers Business App **coexistence** path for eligible numbers (`META_COEXISTENCE_CONFIG_ID` in `.env.example`). Cloud API-only onboarding is implemented via Embedded Signup.

## Scope

1. Product spec: what coexistence UX matches Meta’s current API (onboarding config, sync limits)
2. Implement onboarding flow parallel to Embedded Signup
3. History sync jobs + storage model (if Meta provides sync APIs)
4. Feature flag + Super Admin control; tests and honest limits copy

## Acceptance criteria

- [ ] Eligible businesses can connect via coexistence without README “not implemented” caveat
- [ ] History sync behavior documented (what is / isn’t imported)
- [ ] No regression on standard Cloud API onboarding

## References

- `README.md` Fresh Setup / Meta credentials
- `CONTEXT.md` §4.1 phone registration note
- `lib/meta-onboarding.js` (extend)
