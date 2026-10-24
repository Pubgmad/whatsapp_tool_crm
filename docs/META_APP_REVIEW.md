# Meta App Review demonstration

**Step-by-step recordings (beginner checklist):** [META_RECORDING_PLAYBOOK.md](./META_RECORDING_PLAYBOOK.md) — includes live dashboard status for app **crm** (`2166072280614956`) and which videos to submit.

This guide maps permissions this product actually requests to a recording path. It does not grant Meta approval. App Review, business verification, and Advanced Access are completed in the Meta dashboard. Do not invent metrics, message ids, or ad ids for a recording.

Payment split:

- The CRM subscription (Razorpay) is not part of the Meta review. The dedicated reviewer workspace bypasses that subscription.
- Meta charges separately for WhatsApp messaging and for ads. Do not turn a paused campaign on, and do not spend ad budget, unless a person with spending authority says so.
- Native WhatsApp payments are not part of this review.

Reviewer login is created only on the server:

```bash
# Set REVIEWER_EMAIL, REVIEWER_PASSWORD, REVIEWER_NAME, REVIEWER_BUSINESS_NAME in server env.
npm run reviewer:init
```

The command marks that account's email verified. It does not disable email verification for other users. Do not put the password in this file or in git.

Smoke test before recording, in a private window:

1. Sign in as the reviewer. There should be no email, MFA, or payment wall.
2. Confirm the workspace name is the reviewer business.
3. Open WhatsApp setup and Click-to-WhatsApp ads.
4. Use real test assets. Empty reports stay empty.

## WhatsApp Cloud API

| Item | Value |
| --- | --- |
| Permissions | `whatsapp_business_management`, `whatsapp_business_messaging` |
| Feature | Connect a WABA and number, templates, send, receive |
| UI | Workspace → Connect WhatsApp → Cloud API number |
| API | Embedded Signup code exchange, `POST /{waba}/subscribed_apps`, template and message APIs |
| Assets | A Meta test business, a phone number you control, a consented recipient |
| Dashboard | Embedded Signup configuration id in `META_EMBEDDED_SIGNUP_CONFIG_ID`, webhook URL from `APP_URL` |

Recording:

1. Sign in.
2. Start Cloud API Embedded Signup and finish in the Meta window. Leave it open until the CRM shows the selected number.
3. Create a template and show the status Meta returns. Do not type a fake status.
4. Send that template to the consented test recipient.
5. Show the webhook status or reply in the inbox.

Embedded Signup **v4** is selected by the Facebook Login for Business configuration ID (`META_EMBEDDED_SIGNUP_CONFIG_ID`). Do not send `extras.sessionInfoVersion` or retired `extras.version` values (`v2` / `v3`) — Meta retired those flows on 2026-10-15. Session `WA_EMBEDDED_SIGNUP` postMessages still include `waba_id` and `phone_number_id` automatically on v4.

## Click-to-WhatsApp

| Item | Value |
| --- | --- |
| Permissions | `ads_management`, `pages_manage_ads`, `pages_read_engagement`, `pages_show_list` |
| Also request for reporting | `ads_read` |
| Feature | Authorize, pick a Page and ad account, create a paused CTWA campaign, read its status |
| UI | Click-to-WhatsApp ads → Continue with Facebook, then Create paused campaign |
| API | Facebook Login, `act_{id}/campaigns` and related ad set, creative, and ad calls. Campaigns are created paused. |
| Assets | A Page whose WhatsApp number matches a connected CRM number, an active ad account, a Page role that can advertise |
| Dashboard | Facebook Login redirect `${APP_URL}/api/whatsapp/ads/oauth/callback`, Advanced Access for the scopes above |

Recording:

1. Continue with Facebook and approve the CTWA scopes. Leave "Include lead-form retrieval" off unless that permission is in the submission.
2. Select the Page, ad account, and registered WhatsApp number.
3. Create a paused campaign.
4. Show the Meta campaign id and the live status request. Do not activate it.

Sources checked 2026-10-23:

- https://developers.facebook.com/docs/marketing-api/ad-creative/messaging-ads/click-to-whatsapp/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4/
- https://developers.facebook.com/documentation/development/permissions

## Reporting

| Item | Value |
| --- | --- |
| Permission | `ads_read` |
| UI | Campaign performance → Get report |
| API | `GET /{campaign-id}/insights` |
| Result | Show the numbers Meta returns. If the account is new, say that the range has no delivery yet. |

## Optional, only if that permission is in the submission

| Capability | Extra permissions | UI |
| --- | --- | --- |
| Lead forms | `leads_retrieval`, `pages_manage_metadata` | Check "Include lead-form retrieval" before Facebook Login, then Lead form sync |
| Coexistence | WhatsApp Embedded Signup coexistence config | Connect WhatsApp → Existing Business App number |
| Calling | WhatsApp calling product plus TURN on the server | Calling section. Skip if TURN is not configured. |
| Flows | WhatsApp Flows on the same WABA | Flows designer. Skip if no Flow is published. |
| Conversions | Not requested by the default CTWA connect | Record only if the submission includes the conversions permission |

`business_management` is not requested. This app does not assign Business Manager assets.

A CTWA connect must succeed when lead permissions are absent. Lead sync then asks for a reconnect with lead access enabled.

## Data deletion and backups

Meta user data deletion callbacks remove Meta-sourced lead payloads and copies stored on contacts, events, and audit logs for the requesting principal. Deletion runs in cycles: reconnecting and collecting new data requires a new deletion pass; duplicate callbacks in the same cycle return the same confirmation code.

Database backups can reintroduce rows that were already deleted. After restoring a backup, replay Meta deletion callbacks or use the super-admin deletion queue to resume incomplete work before telling a user erasure is complete.

**Rollback:** After `db/meta-integration-defects.sql` is applied in production, do not roll back the application binary. Migrate the database first, then run only the new (or newer fix-forward) web and worker builds. Details: `docs/PRODUCTION_RUNBOOK.md` → *Meta integration defects release — forward-only migration*.
