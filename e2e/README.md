# Playwright end-to-end checks

Public and unauthenticated flows run in CI without secrets.

## Authenticated workspace flows (optional)

Set these environment variables before `npm run test:e2e`:

- `PLAYWRIGHT_BASE_URL` — deployed or local app URL (HTTPS in production).
- `PLAYWRIGHT_WORKSPACE_EMAIL` / `PLAYWRIGHT_WORKSPACE_PASSWORD` — owner test account.
- `PLAYWRIGHT_SUPER_ADMIN_EMAIL` / `PLAYWRIGHT_SUPER_ADMIN_PASSWORD` — optional super-admin checks.

Without credentials, specs that require login are **skipped** by design. Passing unit tests in the repository does **not** certify live Meta, Shopify, Salesforce, HubSpot, Google, Razorpay, or OpenAI acceptance.

## Recommended production smoke (manual)

1. Meta Setup → **Refresh entitlements** after App Review.
2. Send inbox reply + approved template campaign (Cloud API and MM API if onboarded).
3. Shopify connector webhook → verify `shopify_order_settlements` updates after paid/refund.
4. HubSpot/Salesforce OAuth → **Sync now** with object sync enabled.
5. Worker running; `/api/health` returns 200.
