# Meta App Review Runbook

## Requested permissions

Request only the permissions used by the WhatsApp CRM:

- `whatsapp_business_messaging`
- `whatsapp_business_management`
- `business_management` when using Embedded Signup to onboard and share client business assets

Do not request `whatsapp_business_manage_events` unless the product later implements a feature that genuinely requires it. Meta's current Embedded Signup release guidance requires Advanced Access to `business_management` and `whatsapp_business_management`; Cloud API sending additionally uses `whatsapp_business_messaging`.

## whatsapp_business_messaging description

Mathstrat WhatsApp CRM enables businesses that onboard their own WhatsApp Business Account to communicate with customers who have opted in or initiated a conversation. Company users can send approved WhatsApp message templates and campaigns, reply to customer messages from a shared inbox, send automated responses based on customer input, and retrieve customer-sent media. Incoming messages and message delivery events are received through Meta webhooks and shown only inside the corresponding company workspace. The permission is used only for the connected business's WhatsApp messaging operations and not for unrelated Meta products.

### Screencast

Record a dedicated video for this permission:

1. Sign in to the CRM using a reviewer-accessible company account.
2. Open Meta Setup and show that a WhatsApp Business Account is connected.
3. Open Inbox or Campaigns and send a real WhatsApp message to an allowed, opted-in recipient.
4. Show the same message arriving in WhatsApp Web or the WhatsApp mobile application.
5. Reply from WhatsApp.
6. Return to the CRM and show the incoming reply.
7. Show the sent, delivered, or read status received through the webhook.

The recording must show the action inside this CRM and the result inside a real WhatsApp client. Do not expose access tokens, the App Secret, database credentials, or environment files.

### Required API calls

Perform at least one real call from this application to `POST /{PHONE_NUMBER_ID}/messages`. Also allow Meta to deliver a real `messages` webhook and a real message-status webhook to `/api/webhooks/meta`.

## whatsapp_business_management description

Mathstrat WhatsApp CRM enables each onboarded company to connect and manage its own WhatsApp Business assets. The platform uses this permission to identify the company's WhatsApp Business Account and phone number, subscribe the account to webhooks, create and synchronize WhatsApp message templates, display template approval or rejection status, and show WhatsApp messaging analytics inside that company's private workspace. Access is tenant-isolated and credentials are encrypted server-side.

### Screencast

Record a separate dedicated video for this permission:

1. Sign in to the CRM.
2. Open Meta Setup and start Connect with Meta.
3. Complete Meta Embedded Signup and grant access to the company's WABA and phone number.
4. Return to the CRM and show the WABA ID, Phone Number ID, webhook subscription, and connected status. Do not show the token.
5. Open Templates and create a WhatsApp template with a name, category, language, body, and optional quick replies.
6. Submit the template to Meta.
7. Use Sync from Meta and show the real Pending, Approved, or Rejected state.

### Required API calls

Complete real calls to `GET /{WABA_ID}/phone_numbers`, `POST /{WABA_ID}/subscribed_apps`, and either `POST /{WABA_ID}/message_templates` or template synchronization through `GET /{WABA_ID}/message_templates`.

## Reviewer instructions

1. Open the deployed HTTPS CRM URL.
2. Sign in with the dedicated reviewer company account supplied privately in the App Review form.
3. Use Meta Setup to inspect or complete the WhatsApp connection.
4. Use Templates to create or synchronize a real template.
5. Use Audience to add an opted-in test recipient.
6. Use Campaigns to send an approved template, or use Inbox to reply during an open customer-service window.
7. Use Results and Inbox to verify delivery status and the customer reply.

The reviewer account must not be a Super Admin account and must contain no real customer data.

## Before submission

- The app is deployed over HTTPS and is accessible to the reviewer.
- Privacy Policy and data-deletion information use public URLs.
- Facebook Login for Business allows the production domain and exact OAuth redirect URI.
- The Embedded Signup configuration selects WhatsApp Cloud API, the company's WhatsApp assets, `whatsapp_business_management`, and `whatsapp_business_messaging`.
- The Meta app-level webhook callback is the public `/api/webhooks/meta` URL and uses the same verify token configured on the server.
- Subscribe to the `messages` field.
- `META_WEBHOOK_SIGNATURE_REQUIRED=true` in production.
- A dedicated reviewer login and exact test steps are included in the submission.
- Separate screencasts are uploaded for the two permissions.
- All required API test calls have been made from the Meta app under review.
- The allowed-usage compliance checkbox is accepted only after confirming actual policy compliance.

## Embedded Signup popup troubleshooting

The CRM starts Embedded Signup with `META_APP_ID` and `META_EMBEDDED_SIGNUP_CONFIG_ID`. A generic error rendered inside Facebook occurs before the CRM receives an authorization code, so it normally indicates Meta configuration or asset access rather than the CRM callback API.

1. Confirm the configuration ID belongs to the same Meta app as `META_APP_ID` and has not been deleted or replaced.
2. In Facebook Login for Business, select WhatsApp Cloud API and the WhatsApp management/messaging tasks actually used by the CRM.
3. Add `crm.mathstrat-sites.com` to App Domains and Allowed Domains for the JavaScript SDK.
4. Add the exact production HTTPS redirect URI configured in `META_OAUTH_REDIRECT_URI` to Valid OAuth Redirect URIs. Do not mix `http`, `www`, a trailing path, or another subdomain.
5. Keep Client OAuth Login, Web OAuth Login, HTTPS enforcement, and strict redirect matching enabled.
6. Confirm the Meta user opening the popup has full control over the customer business portfolio and may create or select its WABA and phone number.
7. Confirm the selected WABA is active and not disabled, and that the phone number is not already registered to an incompatible WABA.
8. Retry in a private browser window with popup and third-party login access allowed. Sign in only to the intended Meta account.

The application deliberately does not expose the App Secret or resulting access token to the browser. After Meta returns a code, the server exchanges it, validates its app/scopes, discovers the shared WABA and numbers, subscribes the app to the WABA, and stores the token encrypted.
