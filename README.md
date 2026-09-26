# WhatsApp Growth Desk

A production-oriented Next.js WhatsApp CRM for businesses that need to manage opted-in contacts, approved WhatsApp templates, campaigns, delivery results, inbox replies, and unsubscribe handling.

Data is stored in PostgreSQL and every API action is scoped to the signed-in business workspace.

Production security requires HTTPS, verified database TLS when used, secret rotation, PostgreSQL RLS, transactional email, backups, and regular verification. This repository does not provision those external services automatically.

Workspace data is loaded by active section through `/api/workspace/[section]`. Contacts,
campaign audiences, templates, campaign results, conversations, suppression records, and
message history are paginated on the server. The dashboard uses aggregate queries instead
of downloading complete tenant tables, and mutations return compact results before the
visible section is refreshed.

## Database Choice

Use PostgreSQL for this product.

Why PostgreSQL is the better fit than MongoDB here:

- The data is relational: users, businesses, contacts, templates, campaigns, recipients, conversations, messages, and audit logs all link together.
- Campaign reporting needs accurate counts and joins.
- Business data must be isolated by workspace.
- PostgreSQL gives strong constraints, transactions, indexes, and safer production behavior.

MongoDB can work, but it is less natural for this workflow because the product has many connected records and reporting requirements.

## What Runs Today

- Sign up, sign in, and sign out.
- Company users can belong to multiple business workspaces and switch between authorized memberships.
- PostgreSQL-backed contacts, imports, suppression, restore, and delete.
- PostgreSQL-backed templates with draft, pending, approved, and rejected statuses.
- Campaign creation from approved templates and opted-in contacts.
- Database-backed campaign queue with batch processing and retry tracking.
- Real Meta Cloud API call path for template message sending.
- Recipient records and campaign metrics.
- Inbox conversations, messages, and 24-hour reply-window enforcement.
- STOP / unsubscribe handling through incoming WhatsApp webhooks.
- Meta webhook endpoint for incoming messages and delivery status updates.
- Incoming Click-to-WhatsApp ad/post referrals are stored with the received message and first conversation attribution. This does not create or manage Meta ad campaigns.
- Meta deauthorization and data deletion callbacks with signed-request validation.
- Meta webhook signature validation with `META_APP_SECRET` when enabled/configured.
- Encrypted storage for Meta access tokens when `ENCRYPTION_KEY` is configured.

## Requires Real Meta Credentials

To send real WhatsApp messages, you need:

- Meta Business Account / Business Portfolio.
- Meta App with WhatsApp product enabled.
- WhatsApp Business Account ID, also called WABA ID.
- Dedicated WhatsApp Business phone number.
- Phone Number ID for that number.
- Permanent or system-user access token with WhatsApp permissions.
- Public HTTPS webhook URL pointing to `/api/webhooks/meta`.
- Webhook verify token matching `META_WEBHOOK_VERIFY_TOKEN`.
- Message templates approved by Meta.

Use a business-controlled number for production. Standard Cloud API onboarding may require moving a number off the WhatsApp Business app; eligible businesses can instead use Meta's separate Business App coexistence onboarding flow. This CRM does not yet implement coexistence onboarding or history synchronization.

### Meta account lifecycle callbacks

After deployment and `npm run db:init`, configure these HTTPS URLs in Meta:

```text
Deauthorize callback URL: https://your-domain.example/api/meta/deauthorize
Data Deletion Request URL: https://your-domain.example/api/meta/data-deletion
```

Both callbacks validate Meta's `signed_request` with `META_APP_SECRET`. Deauthorization removes the affected authorization mapping, encrypted access token, and WhatsApp connection. Data deletion additionally creates a non-sensitive confirmation record and returns the status URL required by Meta. Companies connected before this schema was deployed should reconnect once through Embedded Signup so the authorizing Meta user can be mapped securely.

## Fresh Setup

Recommended Node.js: 20 LTS or 22 LTS.

1. Install dependencies

```bash
npm install
```

2. Create PostgreSQL database

Create a database named `whatsapp_crm` in your local PostgreSQL server, or use a hosted PostgreSQL database.

3. Create `.env.local`

Copy `.env.example` to `.env.local` and update at least these values:

```bash
DATABASE_URL=postgresql://postgres:password@localhost:5432/whatsapp_crm
DATABASE_SSL=false
AUTH_SECRET=make-this-long-and-random
ENCRYPTION_KEY=make-this-different-and-random
APP_URL=http://localhost:3000
META_APP_SECRET=your-meta-app-secret
META_WEBHOOK_SIGNATURE_REQUIRED=false
JOB_RUNNER_SECRET=make-this-long-and-random
CAMPAIGN_QUEUE_BATCH_SIZE=25
```

4. Create or migrate tables

```bash
npm run db:init
```

5. Optional owner workspace seed

```bash
npm run db:seed
```

The seed command creates only the owner workspace from `SEED_EMAIL`, `SEED_PASSWORD`, and `SEED_BUSINESS_NAME`. It does not create sample contacts, templates, campaigns, or messages.

### Permanent Meta reviewer workspace

App Review access is provisioned separately from paid subscriptions. Configure `REVIEWER_EMAIL`, `REVIEWER_PASSWORD`, `REVIEWER_NAME`, and `REVIEWER_BUSINESS_NAME` only in the server's ignored `.env.local`, then run:

```bash
npm run db:init
npm run reviewer:init
```

The command creates an active, tenant-isolated company workspace with permanent review access, removes any billing subscription from that workspace, and stores only a salted scrypt password hash. Running it again rotates the password without creating another workspace. Never commit reviewer credentials or provide the Super Admin account to an external reviewer.

6. Start the app

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### Application routes

The production UI uses stable Next.js routes. The root URL sends signed-out users to `/login` and authenticated company users to `/app/dashboard`.

```text
/login                              Company sign in
/signup                             Company registration
/app/dashboard                      Workspace overview
/app/contacts                       Audience and segments
/app/templates                      WhatsApp templates
/app/automations                    Conversation automations
/app/campaigns                      Campaign builder
/app/analytics                      Campaign results
/app/inbox                          Shared inbox
/app/inbox/[conversationId]         Conversation deep link
/app/team                           Team workspace
/app/suppression                    Suppression list
/app/settings/whatsapp              Meta and WhatsApp connection
/app/settings/billing               Subscription, limits, and usage
/super-admin                        Platform overview
/super-admin/companies              Tenant management
/super-admin/plans                  Subscription plan management
/super-admin/content                Platform content management
```

Company and Super Admin page routes are guarded server-side. API routes continue to enforce their own role and tenant authorization independently. Meta-facing webhook, deauthorization, data-deletion, and privacy-policy URLs remain unchanged.

## How To Test Without Meta Credentials

1. Sign up or sign in.
2. Open **Audience** and add contacts with marketing permission enabled.
3. Open **Templates** and create a template.
4. Add your own contacts and submit your own template.
5. After Meta approves the template, open **Campaigns**, select that template, select contacts, enter variable values, and send.
6. Without real Meta credentials, the send action should fail clearly with a Meta configuration error. That is expected production behavior.

## How To Test With Meta Credentials

1. Add `META_WABA_ID`, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN`, and `META_WEBHOOK_VERIFY_TOKEN` to `.env.local`.
2. Restart the development server.
3. Sign in and open **Meta Setup**.
4. Save the WABA ID, Phone Number ID, WhatsApp number, webhook URL, and access token.
5. Create or use an approved WhatsApp template.
6. Send a campaign to an opted-in test contact.
7. Configure Meta webhooks to call `/api/webhooks/meta` so incoming messages and delivery statuses update the inbox/results.
8. Campaign sends are queued first, then processed in batches. For local testing, the app processes the first batch immediately and also shows a **Process queue** button in Results.

## How Data Works

- `users`: login accounts.
- `businesses`: business workspace and Meta/WhatsApp connection settings.
- `memberships`: links users to businesses.
- `contacts`: customer records and opt-in/unsubscribe state.
- `templates`: WhatsApp template records.
- `campaigns`: campaign headers.
- `campaign_recipients`: one send record per selected contact.
- `conversations`: one thread per contact.
- `messages`: incoming and outgoing chat history.
- `whatsapp_accounts`: tenant-scoped WABAs and encrypted Meta authorization state.
- `whatsapp_phone_numbers`: phone assets, registration, quality, profile, and default routing.
- `whatsapp_native_flows`: WhatsApp Flow definitions and Meta publication state.
- `whatsapp_analytics_snapshots`: dated account-level metrics synchronized from Meta.
- `events` and `audit_logs`: operational history.

## Important Production Notes

Before launch, connect these operational pieces:

- Hosted PostgreSQL with backups.
- Managed secret storage for environment variables.
- Webhook signature validation using the Meta app secret.
- Queue-based campaign sending for large batches.
- Rate limits and retry handling for Meta API errors.
- Team roles beyond owner-only access if multiple staff need access.
- Monitoring, error reporting, and audit log views.
- Privacy, consent, and data-retention policies.

## Common Errors

`DATABASE_URL is not configured`: create `.env.local`, set `DATABASE_URL`, and restart `npm run dev`.

`AUTH_SECRET is not configured`: set a long random `AUTH_SECRET` in `.env.local`.

`ENCRYPTION_KEY is required`: set `ENCRYPTION_KEY` before saving a real Meta access token.

`relation does not exist`: run `npm run db:init`.

`password authentication failed`: check your PostgreSQL username/password in `DATABASE_URL`.

`Meta WhatsApp credentials are required before sending messages`: save real Meta credentials in **Meta Setup**.

`Normal reply period expired`: the contact has not messaged within 24 hours, so use an approved template reply.



## Production SaaS Foundation

This branch adds a separate Mathstrat Super Admin layer for subscription SaaS operations. The company CRM remains at `/`, and the platform owner dashboard is available at:

```text
http://localhost:3000/super-admin
```

The Super Admin flow uses its own HTTP-only session cookie and the `/api/super-admin/*` namespace. Every Super Admin route checks the Super Admin session server-side, so normal company admins cannot access platform APIs by discovering URLs.

### Super Admin Environment

Set these only in `.env.local` or your hosted secret manager:

```bash
SUPER_ADMIN_EMAIL=your-platform-admin-email
SUPER_ADMIN_PASSWORD=your-platform-admin-password
SUPER_ADMIN_SESSION_SECRET=make-this-long-and-random
```

Then run:

```bash
npm run db:init
```

The initializer hashes the password and stores only the hash in PostgreSQL. The plain password is not committed, not returned by APIs, and not stored in browser storage.

### Subscription Configuration

Subscription data is stored in PostgreSQL:

- `subscription_plans`: plan catalogue, billing interval, price, limits, active flag.
- `business_subscriptions`: one subscription record per company.
- `billing_events`: future payment and invoice history.

The Super Admin manages plan prices, features, visibility and limits in the database. Optional environment seed data creates only missing plans; it does not overwrite later Super Admin changes:

```bash
DEFAULT_SUBSCRIPTION_PLAN_CODE=your-default-plan-code
SUBSCRIPTION_PLANS_JSON=[{"code":"your-plan-code","name":"Your Plan","billingInterval":"monthly","priceCents":0,"currency":"INR","trialDays":0}]
```

If no default plan is configured, new companies begin with a pending subscription. A visible, active plan with a positive monthly or yearly price can be purchased through Stripe Checkout.

### Stripe billing

Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the server's ignored `.env.local`. Set `APP_URL` to the public HTTPS origin. In Stripe, add a webhook endpoint at `https://your-domain.example/api/webhooks/stripe` and subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. Copy the endpoint's **signing secret**, not its API key, into `STRIPE_WEBHOOK_SECRET`.

Run `npm run db:init` before enabling the webhook. The checkout price is read from the Super Admin-managed plan at purchase time. Existing Stripe subscriptions retain their agreed Stripe price when a plan's displayed price changes; new checkouts use the new price. The Billing screen opens Stripe-hosted Checkout or Customer Portal. Only signed Stripe webhooks update local subscription state. Configure the Customer Portal in Stripe before exposing its button to customers.

Workspace owners can switch active Stripe subscriptions between visible paid plans and monthly/yearly intervals. Stripe invoices prorations immediately; if the required payment cannot be completed, the switch is rejected and the old plan stays in effect. Some payment methods may require the owner to update payment details in the Stripe Customer Portal first. The CRM does not change the local plan until Stripe's signed webhook confirms it.

Monthly message and WhatsApp-conversation limits reset at 00:00 UTC on the first of each calendar month. One confirmed outgoing Meta message consumes one message unit; a conversation unit is one distinct contacted customer in that month. A body-free usage ledger preserves these counts when chat history is deleted. The Super Admin controls usage-record retention separately from message retention; the active monthly window is always retained.

`SUBSCRIPTION_ENFORCEMENT_ENABLED` defaults to enabled. Before deploying this version, assign active subscriptions or trials to existing workspaces and verify Stripe webhooks; otherwise write operations will be blocked. Set `SUBSCRIPTION_ENFORCEMENT_ENABLED=false` only as a temporary, explicit migration override and remove it after the access audit. Expired or unpaid subscriptions cannot create contacts, send messages, start campaigns, create automations, or process queued sends. Existing data remains readable. Reviewer access remains exempt.

CSV contact import columns are `name,phone,permission,tags,opt_in_source,consent_evidence`. New rows without explicit permission are suppressed. A `yes` permission requires a source and specific evidence (at least 10 characters); importing an opted-out contact cannot silently restore marketing permission. Owners and managers can edit contacts and record fresh consent in Suppression. Run `npm run db:init` before using this feature to create the consent audit table.

Users who belong to more than one company can switch workspaces from the sidebar. The server checks membership before issuing a new HttpOnly session cookie, and the browser reloads the workspace to clear the previous tenant's data. Contact CSV export streams in database pages rather than loading every contact into application memory.

New or seeded subscription plans require an explicit three-letter currency code; there is no implicit billing currency. Meta data-deletion callbacks disconnect authorization immediately, then show a pending status if a linked company requires review. The Super Admin reviews these requests under **Data requests** and must verify any remaining Meta Platform Data and retention obligations before confirming completion. The callback itself does not delete all company CRM records.

### Queue worker and retention

The web process alone does not continuously process queued campaigns and automations. Run `npm run worker` as a second managed process (for example, a separate PM2 app) with the same ignored `.env.local`, `JOB_RUNNER_SECRET`, and `JOB_RUNNER_URL=http://127.0.0.1:3000`. The worker polls every `JOB_POLL_INTERVAL_MS` (default 15000) and runs bounded retention once per day. Run only one worker instance until queue concurrency has been capacity-tested. The Super Admin controls retention days; a zero-day setting means keep data. Workspace deletion requests still require explicit approval and are not automatically purged.

`GET /api/health` returns HTTP 200 only when PostgreSQL responds and a successful queue-worker cycle has been recorded recently. It returns HTTP 503 if the database is unavailable or the worker is stale. Run `npm run db:init` before restarting the worker to create the heartbeat and Meta deletion-review tables.

An interrupted send may have reached Meta even if its database result was not saved. Stale processing jobs are marked failed with an explicit *delivery unconfirmed* reason and are **not** automatically resent. Check Meta and the recipient before any manual retry. Provider rate-limit responses remain retryable.

Authentication rate limits are shared through PostgreSQL and applied both per account and per client IP. On the VPS, keep the Next.js port private and configure Nginx to overwrite `X-Real-IP` with `$remote_addr` and `X-Forwarded-For` with `$remote_addr`; do not pass client-supplied forwarding headers through unchanged. Password reset revokes earlier company-user sessions. New production registrations require email verification even when `EMAIL_VERIFICATION_REQUIRED=false`; configure `RESEND_API_KEY`, `EMAIL_FROM`, and an HTTPS `APP_URL` or registration returns 503. Existing accounts are not retroactively locked out by this migration. Run `npm run db:init` before restarting the application after updating. Enable MFA for the Super Admin. Once the initial Super Admin account exists, remove `SUPER_ADMIN_PASSWORD` from the runtime environment; the database retains only its password hash.

For each VPS deployment: pull the intended branch, run `npm ci`, `npm run db:init`, `npm test`, `npm run build`, then restart the web and worker PM2 processes. Back up PostgreSQL before schema changes. Test a Stripe test-mode checkout and its webhook before entering live keys. Do not commit `.env.local` or paste payment keys into commands, tickets, or logs.

This migration requires every WhatsApp Business Account ID and Phone Number ID to belong to only one company. If `db:init` reports duplicate ownership, resolve the affected tenant connections before retrying; do not delete assets blindly. For database integration coverage, set `TEST_DATABASE_URL` to a **separate test database** initialized with `db:init` and run `npm test`. Never point integration tests at the live database.

### Super Admin Capabilities

The Super Admin can currently:

- View total, active, pending, suspended, and WhatsApp-connected companies.
- View subscription status and plan mix.
- Search and filter companies.
- Inspect an individual company without seeing private customer conversations.
- See company owner email, registration date, usage counts, WhatsApp connection status, subscription dates, and recent platform activity.
- Activate or suspend a company.

Suspension is enforced server-side through the normal company account loader, so suspended tenants cannot keep using company CRM APIs.

### Remaining launch checks

Stripe Checkout, plan switching, billing webhooks, Customer Portal, email verification, password reset, invitations, RLS, and a queue worker are implemented. A public launch still needs live Stripe/Meta account configuration and successful end-to-end payment/webhook tests, a database backup/restore drill, uptime and error monitoring, legal review of retention/privacy terms, and a deployment-specific security review.

## WhatsApp Operations

The **Meta Setup** workspace is backed by tenant-scoped PostgreSQL data and the live Meta Graph API. It supports:

- Embedded Signup and manual connection recovery without exposing access tokens to the browser.
- Multiple WABAs and phone numbers, default-number selection, registration, and SMS/voice verification.
- Business profile synchronization and editing.
- Message template submission and synchronization, including media headers, action buttons, and authentication template configuration.
- Interactive reply buttons and list messages inside the 24-hour service window.
- Native WhatsApp Flow creation, JSON upload/validation, publication, and synchronization.
- Per-number Flow encryption keys and a signed, encrypted data-exchange endpoint with workspace-configured responses.
- WhatsApp account analytics snapshots and phone quality/messaging-tier monitoring.
- A capability view that distinguishes working integrations from products that are not integrated.

To use a managed Flow endpoint, set the public HTTPS `APP_URL` and server-only `META_APP_SECRET` and `ENCRYPTION_KEY`. In **Meta Setup > WhatsApp Flows**, configure encryption for the selected phone and wait for Meta to report `VALID`. Create a Flow with **Use CRM data endpoint**, upload its Flow JSON, then save response mappings for `INIT` and each `data_exchange:SCREEN_ID` or `navigate:SCREEN_ID` step before publishing. The mappings are stored per company in PostgreSQL; private keys are encrypted and never returned to the browser. This endpoint returns configured screen data, not a general business-logic engine or a store for submitted personal data.

Coexistence history sync, Calling, Click-to-WhatsApp ad management, specialized Marketing Messages API, per-template insights, OTP app-signature management, and Meta credit-line/payment visibility are **not integrated**. A connected WABA alone does not enable those products. Expired customer authorization is recovered through Embedded Signup reauthorization, not an invented token refresh.

After pulling a release on an existing server, apply the additive schema migration before restarting the app:

```bash
npm install
npm run db:init
npm run build
pm2 restart whatsapp-crm --update-env
```

Use the public webhook callback below and set the same private verify-token value in Meta and `META_WEBHOOK_VERIFY_TOKEN`:

```text
https://crm.mathstrat-sites.com/api/webhooks/meta
```

## Privacy Policy URL for Meta

The public privacy policy route is available at:

```text
/privacy-policy
```

For local preview:

```text
http://localhost:3000/privacy-policy
```

After hosting the app on a real HTTPS domain, use the hosted URL in Meta App Settings. Example:

```text
https://yourdomain.com/privacy-policy
```

Do not use localhost or ngrok for Meta's production Privacy Policy URL. Ngrok is only suitable for temporary webhook testing.
