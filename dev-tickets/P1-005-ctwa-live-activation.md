# P1-005 — CTWA live ads activation

**Status:** Open  
**Priority:** P1  
**Type:** Meta App Review + ops (code largely present)  

## Context

CTWA module code is **strong** in parity registry (`lib/whatsapp-ads.js`, OAuth in `lib/ads-meta-oauth.js`). **Live spend** requires:

- Meta **App Review** for ads scopes (`ads_management`, `ads_read`, pages scopes, etc. — see `CONTEXT.md` §4.3)
- Linked Facebook Page, Ad Account, WhatsApp number
- Worker running for sync jobs
- Optional ad credits wallet (`lib/ad-credits.js`)
- `workspaceProductionPending`: “CTWA ad account” until linked

Paused-create / safe defaults should remain until review complete.

## Tasks

1. Complete Meta App Review for required scopes
2. Connect ad account in workspace Ads settings on staging/production
3. Run paused test campaign; verify insights webhook/poll path
4. Super Admin: confirm feature flags and platform billing if using credits

## Acceptance criteria

- [ ] Production Meta app has Advanced Access for CTWA scopes
- [ ] At least one workspace can create and pause/resume a CTWA campaign without errors
- [ ] No claim of “live ads” in marketing until above verified

## References

- `CONTEXT.md` §4.3, P1 item 9
- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` — Ads CTWA row
