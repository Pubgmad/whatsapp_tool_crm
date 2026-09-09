# WhatsApp Growth Desk

A production-oriented Next.js WhatsApp CRM for businesses that need to manage opted-in contacts, approved WhatsApp templates, campaigns, delivery results, inbox replies, and unsubscribe handling.

Data is stored in PostgreSQL and every API action is scoped to the signed-in business workspace.

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
- One business workspace per owner account.
- PostgreSQL-backed contacts, imports, suppression, restore, and delete.
- PostgreSQL-backed templates with draft, pending, approved, and rejected statuses.
- Campaign creation from approved templates and opted-in contacts.
- Database-backed campaign queue with batch processing and retry tracking.
- Real Meta Cloud API call path for template message sending.
- Recipient records and campaign metrics.
- Inbox conversations, messages, and 24-hour reply-window enforcement.
- STOP / unsubscribe handling through incoming WhatsApp webhooks.
- Meta webhook endpoint for incoming messages and delivery status updates.
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

A personal WhatsApp number should not be used for production. Use a dedicated business number, because a number connected to the WhatsApp Business Platform cannot also be actively used in the normal WhatsApp mobile app in the same way.

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

4. Create tables

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
- `events` and `audit_logs`: operational history.

## Important Production Notes

Before launch, connect these operational pieces:

- Hosted PostgreSQL with backups.
- Managed secret storage for environment variables.
- Real Meta template submission and status sync.
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

Plan setup is environment-driven for now. Configure optional plan seed data with:

```bash
DEFAULT_SUBSCRIPTION_PLAN_CODE=your-default-plan-code
SUBSCRIPTION_PLANS_JSON=[{"code":"your-plan-code","name":"Your Plan","billingInterval":"monthly","priceCents":0,"currency":"INR","trialDays":0}]
```

If no default plan is configured, new companies are created with a pending subscription and can later be assigned a plan when billing management is added.

### Super Admin Capabilities

The Super Admin can currently:

- View total, active, pending, suspended, and WhatsApp-connected companies.
- View subscription status and plan mix.
- Search and filter companies.
- Inspect an individual company without seeing private customer conversations.
- See company owner email, registration date, usage counts, WhatsApp connection status, subscription dates, and recent platform activity.
- Activate or suspend a company.

Suspension is enforced server-side through the normal company account loader, so suspended tenants cannot keep using company CRM APIs.

### Production SaaS Work Still Needed

Before a public SaaS launch, add:

- Payment provider integration and webhook handling.
- Self-service plan upgrade/downgrade.
- Automated renewal and expiry jobs.
- Email verification, password reset, and staff invitations.
- Fine-grained company roles and permissions.
- Meta Embedded Signup for self-service WhatsApp onboarding.
- Hosted cron/worker for campaign queue processing.
- Monitoring, rate-limit dashboards, audit log UI, backups, and legal/compliance policies.

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
