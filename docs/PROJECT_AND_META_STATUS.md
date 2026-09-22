# WhatsApp CRM: Project and Meta Status

Last reviewed: 22 September 2026

This document records the current application state and the Meta/WhatsApp onboarding state. It deliberately separates application code from Meta account approvals. A feature can be implemented in the CRM but still be unavailable until Meta enables the required asset, permission, or account capability.

## 1. Current Application

The project is a multi-tenant WhatsApp CRM SaaS built with Next.js and PostgreSQL. Each company has its own workspace. Company data is tenant-scoped, while the Mathstrat Super Admin operates at platform level.

### Implemented in code

- Next.js production application with stable routes for login, signup, dashboard, contacts, templates, campaigns, analytics, inbox, automations, team, suppression, WhatsApp settings, billing, and Super Admin.
- Company sign-up, sign-in, sign-out, email verification, password reset, MFA, recovery codes, and HTTP-only sessions.
- Separate Super Admin login, MFA, dashboard, company inspection, company activation/suspension, plans, and platform content management.
- PostgreSQL persistence with migrations/initialization and tenant isolation using forced Row Level Security.
- Contacts, opt-in state, suppression/unsubscribe handling, segments, import/export, templates, campaigns, recipients, conversations, messages, audit records, subscriptions, billing records, WhatsApp accounts, phone numbers, native flows, analytics snapshots, and deletion records.
- Server-side pagination and section-specific workspace endpoints. The application does not intentionally download the entire workspace dataset for every navigation.
- Campaign queue processing, automation queue processing, retry tracking, batch sending, delivery results, and job-runner endpoint.
- WhatsApp Cloud API message sending for approved templates.
- Shared inbox for incoming messages and replies within the WhatsApp 24-hour customer-service window.
- Meta webhook verification, signature validation, incoming message handling, delivery/read status handling, and unsubscribe processing.
- Meta deauthorization and data-deletion callback routes with signed-request validation.
- Encrypted server-side storage for Meta access tokens and MFA secrets. Tokens and secrets are not returned to the browser.
- Embedded Signup server exchange/configuration path, manual connection recovery, WABA and phone-number synchronization, and tenant-scoped WhatsApp connection storage.
- WhatsApp template synchronization and management, media headers, action buttons, authentication-template configuration, interactive replies, list messages, native WhatsApp Flow storage/publication support, account analytics snapshots, quality monitoring, and messaging-tier display where Meta exposes the data.
- Responsive UI routes for desktop, tablet, and mobile, with production security headers and the recent redirect-loop fix.
- Privacy policy and data-deletion status pages.
- Production build, unit/integration checks, and Playwright browser/device coverage.

### Intentionally not simulated

The CRM does not invent access to Meta products that are not enabled for the connected account. The following are capability-gated and require separate Meta eligibility, permissions, or product approval:

- WhatsApp Calling API.
- Coexistence with the WhatsApp Business App and its history/contact synchronization.
- Click-to-WhatsApp Ads and advertising management.
- Marketing Messages API.
- Catalog and commerce messages.
- Full Flow encrypted data exchange.
- OTP application package/signature management.
- Meta credit-line or payment-method visibility.
- Automatic authorization recovery. An expired/revoked Meta authorization requires reauthorization through Meta.

## 2. Meta Status Reported So Far

The statuses below reflect information provided during this project. They should be checked again in the Meta Developer Dashboard because Meta can change an app, business, WABA, or phone-number status independently of the CRM.

### Reported as completed

- Business verification: reported as approved.
- Meta App Review: reported as approved.
- Meta app publication: reported as published/live.
- WhatsApp Cloud API test sending: tested successfully in Meta's test environment.
- CRM-to-WhatsApp test sending: a message was sent and received by the test recipient.
- App ID and App Secret: created in Meta. Keep them only in the server environment; never place them in this document or source code.
- At least one WABA ID and Phone Number ID were located during Meta setup. These IDs must be matched to the active WABA and real business phone number actually selected for production.

### Still unconfirmed or blocked

- A production WABA with an active, enabled status.
- The dedicated business phone number successfully added to that production WABA.
- Phone-number verification and registration for the dedicated number.
- A permanent/system-user token with the correct assets and permissions.
- Successful Embedded Signup completion for an external customer business.
- Production webhook subscription to the final WABA, with the `messages` field enabled.
- Successful production delivery/read status callbacks from the real number.
- Tech Provider/access verification, if Meta still shows it as incomplete in the current dashboard.
- Approval or enablement of optional Meta products listed in the previous section.

Important: repeated WABA rows named `Mathstrat` are not proof that the correct production account is active. Each row has a different WABA ID. The WABA ID and Phone Number ID are different identifiers. An account shown as disabled/blocked cannot be used for production onboarding until Meta restores or replaces it.

## 3. Meta Products and Permissions

### Core permissions for this CRM

Request only permissions used by the product:

- `whatsapp_business_messaging`: send messages, reply to customer messages, receive message events, and receive delivery/read statuses.
- `whatsapp_business_management`: view and manage the connected WABA, phone assets, templates, webhook subscription, and WhatsApp settings.
- `business_management`: required when Embedded Signup/onboarding needs to access and share business assets.

Do not request unrelated Facebook, Instagram, advertising, or Messenger permissions. Do not request additional WhatsApp permissions unless the corresponding feature is implemented and actually used.

### Meta configuration values needed by the CRM

These are environment/configuration values, not database content or frontend constants:

```text
META_APP_ID
META_APP_SECRET
META_WABA_ID
META_PHONE_NUMBER_ID
META_ACCESS_TOKEN
META_WEBHOOK_VERIFY_TOKEN
META_EMBEDDED_SIGNUP_CONFIG_ID
META_OAUTH_REDIRECT_URI
APP_URL
```

Production values must be stored in the VPS secret environment or a secret manager. Do not commit `.env.local`, expose `META_APP_SECRET`, or expose `META_ACCESS_TOKEN` to the browser.

## 4. Required Meta Production Setup

Complete these steps in the same Meta Business Portfolio:

1. Confirm the business portfolio is verified and the app belongs to that portfolio.
2. Open Business Settings and select **Accounts > WhatsApp accounts**.
3. Select an active WABA. Do not use a disabled, blocked, test-only, or unrelated WABA.
4. Open the WABA's details and confirm the correct Mathstrat business owner and full-control user access.
5. Open **Phone numbers** and add the dedicated business number if it is not already present.
6. Complete SMS or voice verification and register the number for Cloud API.
7. Confirm the resulting Phone Number ID using WhatsApp Manager or the Graph API.
8. Create a system user, assign the WABA and phone-number assets, and generate a token with only the required permissions. If Meta's current flow provides a permanent token through the approved Embedded Signup flow, store that server-side instead.
9. Configure the Embedded Signup configuration for WhatsApp Cloud API and the approved tasks/permissions.
10. Add the exact production domain and OAuth redirect URI to the Meta app. The URI must match exactly, including scheme, hostname, path, and trailing slash behavior.
11. Configure the public webhook URL:

```text
https://crm.mathstrat-sites.com/api/webhooks/meta
```

12. Use the same private verify-token value in Meta and `META_WEBHOOK_VERIFY_TOKEN`.
13. Subscribe the WABA/app to the `messages` webhook field.
14. Set production signature validation on the server:

```text
META_WEBHOOK_SIGNATURE_REQUIRED=true
```

15. Create or synchronize an approved message template.
16. Send only to opted-in recipients and test incoming messages, delivery, read, unsubscribe, and 24-hour reply handling.

## 5. Meta App Review Submission

### `whatsapp_business_messaging` description

Mathstrat WhatsApp CRM enables businesses to communicate with customers who have opted in or initiated a conversation. Company users send approved WhatsApp templates and campaigns, reply from a shared inbox, and receive incoming messages and delivery events through Meta webhooks. Data is shown only in the connected company's isolated workspace and is not used for unrelated Meta products.

### `whatsapp_business_management` description

Mathstrat WhatsApp CRM lets each onboarded company connect and manage its own WhatsApp Business assets. The permission is used to identify the company's WABA and phone number, subscribe webhooks, create and synchronize templates, show approval state, and display WhatsApp account status and analytics in that company's private workspace. Access tokens are encrypted server-side and tenant access is enforced by the backend.

### Screencast to submit

Record the actual deployed application over HTTPS:

1. Sign in with a dedicated reviewer company account, never a Super Admin account.
2. Open Meta Setup and show a connected WABA and phone number without showing any token or secret.
3. Open Templates and synchronize or create an approved template.
4. Add an opted-in test contact.
5. Send the approved template from Campaigns.
6. Show the message arriving in the real WhatsApp client.
7. Reply from WhatsApp and show the reply arriving in the CRM Inbox.
8. Show delivery/read status received from the webhook.
9. Show the Results page and template status.
10. For management permission, show asset/template synchronization and status, not private customer conversations.

Never record passwords, App Secret, access tokens, database credentials, or `.env.local`.

### Reviewer access

Create a dedicated reviewer company account using server-side environment variables such as `REVIEWER_EMAIL`, `REVIEWER_PASSWORD`, `REVIEWER_NAME`, and `REVIEWER_BUSINESS_NAME`, then run `npm run reviewer:init`. The account is permanent, tenant-isolated, and does not require a paid subscription. Do not use the Super Admin credentials for Meta review.

## 6. URLs to Configure in Meta

Use the real HTTPS domain after deployment:

```text
Privacy Policy:
https://crm.mathstrat-sites.com/privacy-policy

Deauthorize callback:
https://crm.mathstrat-sites.com/api/meta/deauthorize

Data deletion request:
https://crm.mathstrat-sites.com/api/meta/data-deletion

WhatsApp webhook:
https://crm.mathstrat-sites.com/api/webhooks/meta
```

The callback routes are implemented. They still require Meta to send a real signed request during testing. Do not use localhost for Meta production configuration.

## 7. What Is Needed Before Public SaaS Launch

### Must be completed

- Active, non-blocked production WABA.
- Dedicated verified and registered business phone number.
- Correct production Phone Number ID and WABA ID.
- Production system-user or approved permanent access token.
- Successful webhook verification and subscription.
- Approved templates for outbound messages.
- Reviewer account and App Review screencast/test instructions.
- HTTPS certificate and working domain.
- PostgreSQL backups and restore test.
- Production email sender for verification and password recovery.
- Monitoring, error tracking, job monitoring, and alerting.
- Meta and WhatsApp policy, consent, privacy, retention, and deletion procedures.

### Recommended next production improvements

- Payment provider and billing webhooks for subscriptions.
- Automated renewal/expiry enforcement.
- Hosted worker/cron for campaign and automation queues.
- Formal end-to-end Meta integration test environment.
- Secret manager and scheduled secret rotation.
- Data-retention review workflow and approved deletion execution.
- Customer support and audit-log operations.
- Explicit onboarding/recovery UI for partially completed Embedded Signup.

## 8. Safe Testing Layers

### Local without Meta credentials

You can test authentication, contacts, templates, audiences, campaign validation, inbox UI, automation configuration, Super Admin, tenant isolation, responsive routes, and error states. Real WhatsApp sending will not work.

### Meta test environment

Use Meta's test WABA/number and allowed test recipients. This proves the Cloud API call path, but it does not prove that a customer can onboard their own business in production.

### Production Meta connection

Use only the active production WABA, verified dedicated number, production token, approved templates, HTTPS webhook, and opted-in recipients. Test one controlled recipient before any wider campaign.

## 9. Final Status Summary

The CRM application code is production-oriented and contains the main WhatsApp CRM, tenant, security, SaaS, webhook, and Meta integration foundations. Meta approvals are separate from code. Based on the project updates, business verification and App Review/publication were reported as complete, while the active production WABA/phone-number onboarding remains the main external blocker because Meta showed disabled/blocked accounts and WABA-null setup errors.

The next practical action is to identify or create one active WABA in the correct Mathstrat Business Portfolio, add and verify the dedicated number there, generate the correct token, configure the webhook, and run the end-to-end reviewer flow. Do not create more duplicate WABAs until Meta confirms which account is active.
