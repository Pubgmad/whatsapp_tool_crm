# Domain and staging-to-production configuration

Changing the public hostname does not move Meta App Review to a different Meta app. Keep the same Meta app unless you intend to submit again. A business-identity change, new permission, or new app can require another review. This checklist does not promise that Meta will skip review.

Runtime URLs come from `APP_URL`. OAuth, webhooks, and deletion links should not contain a hard-coded host.

## Set on the server

| Variable | Production value |
| --- | --- |
| `APP_URL` | `https://<public-host>` with no trailing path |
| `META_APP_ID` / `META_APP_SECRET` | Same Meta app |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | Configuration that belongs to that app |
| `META_COEXISTENCE_CONFIG_ID` | Only if coexistence is submitted |
| `META_WEBHOOK_VERIFY_TOKEN` | The verify token saved in the Meta app |
| `META_OAUTH_REDIRECT_URI` | Leave empty unless Embedded Signup token exchange requires an explicit redirect |
| `REVIEWER_EMAIL` and `REVIEWER_PASSWORD` | Server env only, then `npm run reviewer:init` |
| Session | `AUTH_SECRET` unchanged or rotated with `npm run security:rotate-secrets`. Cookie is `Secure` when `NODE_ENV=production`. |

Allowed browser origins for CRM requests are the request origin and `APP_URL`. Embedded Signup messages are accepted only from `https://www.facebook.com`, `https://web.facebook.com`, `https://business.facebook.com`, and `https://m.facebook.com`.

## Change in the Meta app dashboard

| Field | Value |
| --- | --- |
| App domains | Public host |
| Facebook Login allowed domains / Valid OAuth redirect URIs | `https://<public-host>/api/whatsapp/ads/oauth/callback` |
| WhatsApp webhook callback | `https://<public-host>/api/webhooks/meta` |
| Deauthorize callback | `https://<public-host>/api/meta/deauthorize` |
| Data deletion request URL | `https://<public-host>/api/meta/data-deletion` |
| Privacy policy | `https://<public-host>/privacy-policy` |
| Embedded Signup configuration | Same configuration id, updated allowed domains if Meta shows that field |

After deploy, run `npm run db:init` so `ads_oauth_attempts` and the authorization columns exist, then restart the web process and the worker.

## Smoke test after the host change

1. Sign in, including the reviewer account in a private window.
2. Start Facebook Login for ads and return to the CRM on the new host.
3. Complete Embedded Signup for a test number, or confirm an existing connection still checks out.
4. Confirm a signed webhook arrives (send a test message and look at connection health, not only the configured URL).
5. Send a template to a consented recipient and confirm the reply or status.
6. Remove the app in Facebook settings and confirm the workspace credentials are cleared without touching another workspace.
7. Open the data-deletion status URL from Meta's response and confirm it shows a status without workspace or user ids.

## Backups and deletion

Database backups can still contain rows after the live database is deleted. Retention follows the operator backup schedule in `docs/PRODUCTION_RUNBOOK.md`. Restoring a backup can bring deleted Meta data back. After a restore, run failed Meta deletion requests again and treat deletion requests that completed after the backup was taken as needing another pass. The public status page must still show only the confirmation code and status.
