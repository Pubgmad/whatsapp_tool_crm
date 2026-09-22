# Production Security Operations

## Controls implemented

- Signed double-submit CSRF tokens and strict origin validation protect browser mutations.
- PostgreSQL-backed rate limits cover login, recovery, invitations, and authenticated APIs.
- Passwords use salted `scrypt`; Meta tokens and MFA secrets use AES-256-GCM encryption.
- Email verification, password reset, TOTP MFA, and single-use recovery codes are available. Super Admin has a separate MFA flow.
- Sessions are HTTP-only, SameSite cookies and become Secure in production.
- PostgreSQL forced RLS covers business-owned CRM, WhatsApp, subscription, billing, and deletion data.
- Current and previous session/encryption secrets support controlled key rotation.
- Retention jobs report records due under database-controlled retention settings. Workspace deletion becomes `pending_approval` after its grace period; destructive tenant purging is never performed without an explicit platform-owner approval workflow.

## Production database role

Run the application with a dedicated PostgreSQL login that is not a superuser and does not have `BYPASSRLS`. Run `npm run db:init` during deployment. The schema forces RLS even for the table owner; server code establishes either a tenant context or the separate system context required by signed webhooks, background jobs, and Super Admin operations.

## Secret storage and rotation

Do not commit `.env.local`. In production, inject environment variables through the VPS service manager or a dedicated secret manager. Restrict the environment file to the deployment account (`chmod 600`). Never expose values through `NEXT_PUBLIC_*` variables.

To rotate encrypted values:

1. Put the old key in `ENCRYPTION_KEY_PREVIOUS` and the new random key in `ENCRYPTION_KEY`.
2. Run `npm run security:rotate-secrets` once.
3. Restart the application and verify Meta connections and MFA.
4. Remove `ENCRYPTION_KEY_PREVIOUS` after the rollout window.

Session secrets can use the same current/previous rollout with `AUTH_SECRET_PREVIOUS` and `SUPER_ADMIN_SESSION_SECRET_PREVIOUS`. Existing sessions signed by the previous key remain valid during the transition.

## Required production email configuration

Set `RESEND_API_KEY`, a verified `EMAIL_FROM` sender, `APP_URL=https://crm.mathstrat-sites.com`, and `EMAIL_VERIFICATION_REQUIRED=true`. Test registration, resend verification, password reset, and link expiry before enabling public registration.

## Scheduled jobs

Call `/api/jobs/run` from a protected cron request using `JOB_RUNNER_SECRET`. It processes campaign jobs, automation jobs, and the retention review. Keep the endpoint inaccessible without that secret and monitor non-2xx responses.

## Verification commands

```bash
npm run db:init
npm test
npm run build
npm run test:e2e
```

CI runs PostgreSQL migrations, unit/integration checks, a production build, and Playwright across Chromium, Firefox, WebKit, Pixel 7, and iPhone 15 profiles.
