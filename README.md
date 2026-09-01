# WhatsApp Growth Desk

A Next.js WhatsApp CRM for businesses that need to manage opted-in contacts, approved WhatsApp templates, campaigns, delivery results, inbox replies, and unsubscribe handling.

This branch is no longer using local JSON storage. Data is stored in PostgreSQL and every API action is scoped to the signed-in business workspace.

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
- Campaign creation from approved templates only.
- Recipient records and campaign metrics.
- Inbox conversations, messages, and 24-hour reply-window enforcement.
- STOP / unsubscribe handling.
- Meta webhook endpoint for incoming messages and delivery status updates.
- Encrypted storage for Meta access tokens when `ENCRYPTION_KEY` is configured.

## Still Mocked Until Meta Credentials Exist

- Local campaign sends run in `Mock Meta` mode and create sent recipient records without contacting WhatsApp.
- Template approval can still be manually changed in the UI for local testing.
- The inbox has local test reply buttons when `ENABLE_MOCK_META=true`.

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

A personal WhatsApp number should not be used if you want production. Use a dedicated business number, because a number connected to the WhatsApp Business Platform cannot also be actively used in the normal WhatsApp mobile app in the same way.

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
ENABLE_MOCK_META=true
```

4. Create tables

```bash
npm run db:init
```

5. Optional seed data

```bash
npm run db:seed
```

The seed command creates a demo owner account only when you run it. Default login:

```text
owner@example.com
Password123!
```

6. Start the app

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## How To Test The Main Workflow

1. Sign up or sign in.
2. Open **Audience** and add contacts with marketing permission enabled.
3. Open **Templates**, create a template like `Hi {{name}}, get {{discount}} off today.`, then mark it approved.
4. Open **Campaigns**, select the approved template, select contacts, enter a discount, and send.
5. Open **Results** to see campaign recipient records and status counts.
6. Open **Inbox** and use **Test reply** to simulate an incoming WhatsApp message.
7. Reply normally if the contact is inside the 24-hour customer-service window.
8. Use **Test STOP** to confirm the contact moves to suppression and is excluded from future campaigns.

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

Before real production launch, add:

- Hosted PostgreSQL with backups.
- Managed secret storage for environment variables.
- Real Meta template submission and status sync.
- Webhook signature validation using the Meta app secret.
- Queue-based campaign sending for large batches.
- Rate limits and retry handling for Meta API errors.
- Team roles beyond owner-only access.
- Monitoring, error reporting, and audit log views.
- Privacy, consent, and data-retention policies.

## Common Errors

`DATABASE_URL is not configured`: create `.env.local`, set `DATABASE_URL`, and restart `npm run dev`.

`AUTH_SECRET is not configured`: set a long random `AUTH_SECRET` in `.env.local`.

`ENCRYPTION_KEY is required`: set `ENCRYPTION_KEY` before saving a real Meta access token.

`relation does not exist`: run `npm run db:init`.

`password authentication failed`: check your PostgreSQL username/password in `DATABASE_URL`.

`Normal reply period expired`: the contact has not messaged within 24 hours, so use an approved template reply.
