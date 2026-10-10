import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProviderEvent } from '../lib/provider-connectors.js';
import { SHOPIFY_WEBHOOK_TOPICS } from '../lib/shopify-auth.js';

test('Shopify OAuth webhook topics include checkout and order create', () => {
  const topics = SHOPIFY_WEBHOOK_TOPICS.map((item) => item.topic);
  assert.ok(topics.includes('CHECKOUTS_CREATE'));
  assert.ok(topics.includes('CHECKOUTS_UPDATE'));
  assert.ok(topics.includes('ORDERS_CREATE'));
});

test('normalizeProviderEvent accepts Shopify abandoned checkout', () => {
  const event = normalizeProviderEvent('shopify', 'checkouts/update', {
    token: 'abc123token',
    updated_at: new Date().toISOString(),
    phone: '+919876543210',
    total_price: '499.00',
    currency: 'INR',
    abandoned_checkout_url: 'https://example.myshopify.com/checkouts/abc'
  });
  assert.equal(event.resource, 'checkout');
  assert.equal(event.phone, '919876543210');
  assert.ok(event.checkoutUrl.includes('https://'));
  assert.equal(event.terminal, false);
});

test('normalizeProviderEvent accepts WooCommerce checkout.abandoned with digit phone', () => {
  const event = normalizeProviderEvent('woocommerce', 'checkout.abandoned', {
    id: 'cart_99',
    date_modified_gmt: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
    billing: { phone: '919876543210' },
    total: '120.50',
    currency: 'INR',
    checkout_url: 'https://shop.example.com/cart/?recover=1'
  });
  assert.equal(event.resource, 'checkout');
  assert.equal(event.phone, '919876543210');
  assert.ok(event.checkoutUrl.startsWith('https://'));
});

test('normalizeProviderEvent drops invalid Woo phone but keeps order for store mirror', () => {
  const event = normalizeProviderEvent('woocommerce', 'order.created', {
    id: 12,
    date_created_gmt: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
    billing: { phone: '000' },
    total: '10.00',
    currency: 'USD',
    status: 'processing'
  });
  assert.equal(event.phone, '');
  assert.equal(event.resource, 'order');
});

test('normalizeProviderEvent allows Woo order with empty phone for store mirror', () => {
  const event = normalizeProviderEvent('woocommerce', 'order.created', {
    id: 55,
    date_created_gmt: new Date().toISOString().replace(/\.\d{3}Z$/, ''),
    billing: { phone: '' },
    total: '10.00',
    currency: 'USD',
    status: 'processing'
  });
  assert.equal(event.resource, 'order');
  assert.equal(event.phone, '');
});

test('checkout recovery analytics helper exports', async () => {
  const mod = await import('../lib/checkout-recovery-analytics.js');
  assert.equal(typeof mod.checkoutRecoveryAnalytics, 'function');
});

test('payment reconcile job exports', async () => {
  const mod = await import('../lib/payment-reconcile-jobs.js');
  assert.equal(typeof mod.runPaymentReconcileJobs, 'function');
});
