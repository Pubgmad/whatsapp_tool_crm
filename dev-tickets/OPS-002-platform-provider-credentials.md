# OPS-002 — Platform provider credentials matrix

**Status:** Ops — [PRODUCTION_RUNBOOK.md](../docs/PRODUCTION_RUNBOOK.md) § OPS-002  
**Priority:** Ops  
**Type:** Configuration  

## Context

Many modules are **code-complete** but need server env and external approval. Use this ticket as the master checklist for **platform** (not per-tenant) secrets on production VPS.

| Area | Env keys (see `.env.example`) | Notes |
|------|-------------------------------|--------|
| Meta WhatsApp | `META_APP_ID`, `META_APP_SECRET`, webhook verify token, Embedded Signup config | App Review for customer WABAs |
| Razorpay platform | `RAZORPAY_KEY_*`, webhook secret | Test mode before live keys |
| Email | `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL` HTTPS | Required for signup verification in prod |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | AI Agents / support suggestions |
| TURN | `WHATSAPP_CALL_TURN_URLS`, `WHATSAPP_CALL_TURN_SECRET` | Calling |
| Google login | `GOOGLE_LOGIN_*` | OPS-001 |
| Google Calendar | `GOOGLE_CLIENT_*` | Flow booking |
| Shopify platform | `SHOPIFY_CLIENT_*`, privacy webhooks flag | Partner dashboard compliance |
| CRM connectors | `HUBSPOT_*`, `SALESFORCE_*` | OAuth apps per provider |
| Dialogflow | `DIALOGFLOW_*`, `GOOGLE_DIALOGFLOW_SERVICE_ACCOUNT_JSON` | Optional bots |
| Encryption | `ENCRYPTION_KEY`, `AUTH_SECRET`, rotation policy | Token storage |

Per-tenant: merchant Razorpay, store URLs, workspace API keys — not on this checklist.

## Acceptance criteria

- [ ] Documented `.env` template filled for production (secrets in vault, not git)
- [ ] Each integration smoke-tested or marked N/A with owner sign-off
- [ ] Super Admin parity / production hub blockers trend down after connect

## References

- `CONTEXT.md` §4–5
- `README.md` Remaining launch checks
- `docs/INBOX_AND_PRODUCTION_AUDIT.txt` §C connectors
