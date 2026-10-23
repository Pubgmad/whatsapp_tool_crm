# P0-004 — Meta webhook signature enforcement (production)

**Status:** Open  
**Priority:** P0  
**Type:** Security  

## Context

Meta webhooks must verify `X-Hub-Signature-256` using `META_APP_SECRET`. Audit notes **fail-open** behavior when secret unset or `META_WEBHOOK_SIGNATURE_REQUIRED=false` outside strict production.

Local dev uses `META_WEBHOOK_SIGNATURE_REQUIRED=false` in `.env.local` — acceptable for localhost only.

## Tasks

1. Production `.env`: set `META_APP_SECRET`, `META_WEBHOOK_SIGNATURE_REQUIRED=true` (or production fail-closed default per code path)
2. Send test webhook without signature → must reject
3. Send valid signed test payload → must accept
4. Document verify token and callback URL in Meta Developer Console

## Acceptance criteria

- [ ] Unsigned or tampered webhook requests rejected in production
- [ ] Live message/status events still processed
- [ ] No regression on deauthorize / data-deletion signed_request flows

## References

- `README.md` Meta webhooks
- `CONTEXT.md` §4.8, P0 item 4
- `lib/meta-signed-request.js` / webhook route handlers
