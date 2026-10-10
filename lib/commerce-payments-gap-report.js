/**
 * Commerce & Payments completion snapshot (code-backed; not a live Meta/Shopify verification).
 * AiSensy capabilities cited from aisensy.com integrations pages (Shopify, WooCommerce, Razorpay, Catalogues).
 */
export const COMMERCE_PAYMENTS_GAP_REPORT = Object.freeze({
  generatedForBranch: 'production_saas',
  modules: [
    {
      module: 'Catalog & Orders',
      aisensy: 'Meta Commerce Manager catalog + Shopify products in flows; single/multi product messages; profile catalogue toggle',
      previous: 'Read-only Graph catalogs/products; WhatsApp order ingest; fulfillment transitions; no store-order mirror',
      gaps: 'No Meta catalog CRUD; store orders not in inbox; payment reconcile unwired',
      implemented: 'Wire Meta payment→order reconcile; commerce_store_orders mirror; inbox timeline store orders; ops center enrichment',
      tests: 'whatsapp-commerce.test.mjs pass; commerce-payments-production.test.mjs pass',
      external: 'Meta catalog permissions; WABA product catalogs',
      status: 'Production-shaped; Awaiting Live Verification for catalog sync with merchant WABA'
    },
    {
      module: 'Shopify Connector',
      aisensy: 'App Store token connect; abandoned cart ×3; COD/order/fulfillment flows; dynamic product images',
      previous: 'OAuth + webhook connector; drafts/settlement; recovery Shopify-only; checkout webhooks not auto-registered',
      gaps: 'CHECKOUTS_* / ORDERS_CREATE missing from OAuth reconcile; last_error schema drift',
      implemented: 'Register ORDERS_CREATE/CANCELLED + CHECKOUTS_CREATE/UPDATE; last_error/last_sync_at/config columns; multi-step recovery 1–3',
      tests: 'shopify-webhooks.test.mjs updated + pass',
      external: 'Shopify app credentials; read_orders scope; live shop webhooks',
      status: 'Production-shaped; Awaiting Live Verification on installed Shopify app'
    },
    {
      module: 'WooCommerce Connector',
      aisensy: 'Consumer key/secret connect; abandoned cart; order/delivery/COD notifications',
      previous: 'Webhook ingest order.created/updated only; no recovery UI; stub tests',
      gaps: 'No cart events via REST; no recovery; weak phone matching',
      implemented: 'checkout.abandoned topic; recovery UI+worker for Woo; digit phone normalization; store order mirror',
      tests: 'commerce-payments-production.test.mjs Woo abandoned normalize',
      external: 'WooCommerce signed webhooks + abandoned-cart extension/middleware (REST alone insufficient)',
      status: 'Production-shaped webhook pipe; Awaiting Live Verification + cart extension'
    },
    {
      module: 'Checkout Recovery',
      aisensy: 'Up to 3 abandoned-cart reminders; template timing; dashboard metrics',
      previous: 'Single Shopify attempt; flag off by default; no analytics table',
      gaps: 'No multi-step; no Woo; no verified revenue analytics',
      implemented: '1–3 attempts + step delay; Shopify+Woo; checkout_recovery_events; analytics API/UI; purchase suppression→recovered',
      tests: 'Unit coverage for event normalize + analytics export',
      external: 'checkout_recovery feature flag; marketing templates; worker process; live checkout webhooks',
      status: 'Production-shaped; Awaiting Live Verification with real abandoned checkouts'
    },
    {
      module: 'Razorpay + Native WhatsApp Payments',
      aisensy: 'Razorpay activities: payment link, invoice, subscription halted, refund → WhatsApp campaigns; WA API via Razorpay path',
      previous: 'Hosted payment links + native INR order_details; webhooks; no stale reconcile job; Meta payment path unwired',
      gaps: 'reconcileWhatsAppPayment unused; no worker reconcile; no activity→flow bindings',
      implemented: 'Meta payment webhook dual-path; paymentReconcile worker job; merchant_payment_activities dispatch; exported reconcile helpers',
      tests: 'whatsapp-commerce payment tests; payment-reconcile export',
      external: 'Razorpay live/test keys; webhook URL; Meta India native payment eligibility',
      status: 'Production-shaped for hosted+native INR; Awaiting Live Verification'
    }
  ]
});

export function commercePaymentsComparisonTable() {
  return COMMERCE_PAYMENTS_GAP_REPORT.modules.map((row) => ({
    Module: row.module,
    'AiSensy Capability': row.aisensy,
    'Previous CRM Status': row.previous,
    'Gaps Identified': row.gaps,
    'Improvements Implemented': row.implemented,
    'Test Results': row.tests,
    'External Dependencies': row.external,
    'Final Status': row.status
  }));
}
