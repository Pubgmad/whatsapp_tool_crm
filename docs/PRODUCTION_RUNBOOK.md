# Production runbook — MathStrat WhatsApp CRM

Operator steps for VPS **crm.mathstrat-sites.com**. Application code ships from `main` after merge of `feature/dev`; track release SHA in Super Admin notes (P0-002).

## What is “TURN env on the VPS”?

WhatsApp **browser calling** uses WebRTC. Most users are behind NAT/firewalls, so audio must relay through a **TURN** server (Traversal Using Relays around NAT).

On the **same machine** that runs `npm run start`, set in `.env` (not in git):

| Variable | Meaning |
|----------|---------|
| `WHATSAPP_CALL_TURN_URLS` | Comma-separated relay URLs, e.g. `turns:turn.mathstrat-sites.com:5349?transport=tcp` |
| `WHATSAPP_CALL_TURN_SECRET` | Shared secret your TURN server uses to validate time-limited credentials the app mints |

You still need Meta **calling enabled** on the phone (see `/app/calling` → Load settings). TURN alone does not replace Meta entitlement.

Typical setup: run [Coturn](https://github.com/coturn/coturn) on the VPS or use a managed TURN provider; point DNS/firewall at the relay port; put URL + secret in env; restart web + worker.

---

## P0-001 — Queue worker

```bash
cd /path/to/whatsapp_tool_crm
pm2 start ecosystem.config.cjs --only whatsapp-crm-worker
# or: pm2 start ecosystem.config.cjs   # web + worker
```

- Same `.env` as web: `JOB_RUNNER_SECRET`, `DATABASE_URL`, `APP_URL=https://crm.mathstrat-sites.com`
- Optional: `JOB_RUNNER_URL=http://127.0.0.1:3000`
- Verify: `curl -fsS https://crm.mathstrat-sites.com/api/health` → 200, worker heartbeat fresh
- Workspace **Production hub** → Background worker **ready**

---

## P0-002 — Deploy verification

1. Record running **git SHA** on host vs intended `main` / release tag.
2. After deploy: `npm run db:init` with `DATABASE_MIGRATION_URL` (migrations + RLS grants + Free Forever seed).
3. Smoke: login → `/app/settings/whatsapp` → hard refresh `/app/inbox` → `/pricing` shows Free Forever.
4. Meta: send test webhook to `/api/webhooks/meta` (signed).
5. Log date, SHA, operator in Super Admin notes.

---

## P0-003 — Super Admin MFA + DB RLS

1. Super Admin → enable MFA (authenticator); store recovery codes offline.
2. Remove `SUPER_ADMIN_PASSWORD` from production runtime env after initial `db:init`.
3. Runtime `DATABASE_URL` → role with **no** `BYPASSRLS` / not superuser; migrations via `DATABASE_MIGRATION_URL` only.
4. Re-run `db:init` grants; Production hub → Database tenant isolation **ready**.

---

## P0-004 — Meta webhook signatures

Production ( `NODE_ENV=production` ) **requires** valid `META_APP_SECRET`; unsigned webhooks are rejected.

1. Set `META_APP_SECRET` from Meta Developer Console → App → Settings.
2. Callback: `https://crm.mathstrat-sites.com/api/webhooks/meta`
3. Test: unsigned POST → 401; signed test event → 200.
4. Local dev may use `META_WEBHOOK_SIGNATURE_REQUIRED=false` only on localhost.

---

## OPS-001 — Google login

1. Google Cloud → OAuth Web client.
2. Redirect: `https://crm.mathstrat-sites.com/api/auth/google/callback`
3. Env: `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`
4. See `docs/GOOGLE_LOGIN_SETUP.md`

---

## OPS-002 — Platform credentials

Fill `.env` from `.env.example` (secrets in vault). Smoke each integration or mark N/A:

Meta, Razorpay, email (`RESEND_*`), OpenAI, TURN, Google login/calendar, Shopify, CRM connectors, Dialogflow, `ENCRYPTION_KEY` / `AUTH_SECRET`.

---

## Meta integration defects release — forward-only migration

This release adds `db/meta-integration-defects.sql` (remote cleanup jobs, ads OAuth `login_session_id`, lead provenance columns, deletion cycle metadata). **Treat deployment as forward-only.**

1. **Order of operations:** On the target database, run `npm run db:init` with `DATABASE_MIGRATION_URL` (or apply `db/meta-integration-defects.sql` once) **before** starting new web **and** worker processes. Do not start new app binaries against an unmigrated schema.
2. **No application rollback after migration:** Older builds ignore `meta_remote_cleanup_jobs`, may mishandle disconnect without remote cleanup, and do not bind ads OAuth to the browser session. Reverting the app while the schema is migrated is unsupported.
3. **Recovery:** Fix-forward only—deploy a corrected newer release, drain or complete `meta_remote_cleanup_jobs`, replay Meta deletion callbacks if needed, and use Super Admin → **Deletion review** for `partial_legacy` outcomes.
4. **Validation:** Optional throwaway check: `node scripts/migration-matrix.mjs` against local Postgres (creates and drops `wcrm_mig_*`).

See also `docs/META_APP_REVIEW.md` (rollback note).

---

## P1-004 — Calling TURN

See **TURN env** section above + `CONTEXT.md` §4.5.

---

## P1-005 — CTWA live ads

Requires Meta **App Review** (ads scopes), linked Page + Ad Account + phone, and **worker** running. CRM creates campaigns **paused** by default until operator activates after review.

---

## P1-006 — Coexistence

Implemented: Meta Setup → **Existing Business App number** (`featureType: whatsapp_business_app_onboarding`). Progress in **Coexistence** panel; history sync via `lib/coexistence.js`. Limits: see Meta docs for eligible numbers and sync caps.

---

## P2-001 — Paid plan prices

Commercial approval → Super Admin → Plans: set prices, `visible`, `is_active`. Keep Free Forever default for signups.

---

## P2-003 — CMS republish

Super Admin → CMS: review vs product IA → Reset defaults (careful) → Publish. Smoke `/`, `/products`, `/features/*`, `/pricing`.

---

## P2-004 — Mobile / a11y

```bash
npm run test:e2e
A11Y_E2E_REPORT=1 node scripts/record-a11y-e2e.mjs
```

Record attestation in Super Admin when green; fix blockers on `feature/dev`.
