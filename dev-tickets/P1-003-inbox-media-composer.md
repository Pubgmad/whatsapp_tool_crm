# P1-003 — Inbox composer: send media

**Status:** Done (feature/dev) — `POST /api/messages/reply-media` + inbox Paperclip composer (image/video/audio/PDF/text)  
**Priority:** P1  
**Type:** Engineering  

## Context

Shared inbox supports reply, templates, assignment, SLA. Audit documents **no media send from composer** (images/docs/audio) and limited optimistic concurrency in UI.

## Scope

1. Upload + send media via Meta Cloud API path used elsewhere (`lib/meta-media.js` or actions layer)
2. Respect 24-hour session window and plan limits
3. UI: attach control, progress, error states
4. Tests for API validation and permission checks

## Acceptance criteria

- [ ] Agent can send at least image + document from inbox composer when WABA connected
- [ ] Out-of-window sends blocked with clear message
- [ ] Media appears in conversation timeline

## References

- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` — Inbox reply row
- `CONTEXT.md` P1 item 7
