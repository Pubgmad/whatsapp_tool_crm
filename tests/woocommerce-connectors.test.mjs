import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import {connectorSource,normalizeProviderEvent,providerTopics,verifyProviderSignature,woocommerceSetupGuide} from '../lib/provider-connectors.js';

test('provider connectors exposes WooCommerce provider id and topics', () => {
  assert.deepEqual(providerTopics('woocommerce'), ['order.created', 'order.updated', 'checkout.abandoned']);
  const guide = woocommerceSetupGuide('pc_test');
  assert.equal(guide.signatureHeader, 'x-wc-webhook-signature');
  assert.match(guide.deliveryPath, /pc_test/);
  assert.ok(guide.requirements.length >= 4);
});

test('WooCommerce store source must be public HTTPS without credentials', () => {
  assert.equal(connectorSource('woocommerce', 'https://shop.example.com/'), 'https://shop.example.com');
  assert.throws(() => connectorSource('woocommerce', 'http://shop.example.com'), { code: 'CONNECTOR_SOURCE_INVALID' });
  assert.throws(() => connectorSource('woocommerce', 'https://user:pass@shop.example.com'), { code: 'CONNECTOR_SOURCE_INVALID' });
});

test('WooCommerce HMAC signatures verify exactly', () => {
  const secret = 'woocommerce-signing-secret-123';
  const raw = Buffer.from(JSON.stringify({ id: 42, total: '12.00', currency: 'USD', status: 'processing', billing: { phone: '+15551234567' }, date_created_gmt: '2026-01-02T10:00:00' }));
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  assert.equal(verifyProviderSignature(raw, signature, secret), true);
  assert.equal(verifyProviderSignature(raw, 'not-a-signature', secret), false);
});

test('WooCommerce order.created normalizes phone, amount, and GMT timestamps', () => {
  const event = normalizeProviderEvent('woocommerce', 'order.created', {
    id: 9001,
    total: '49.50',
    currency: 'usd',
    status: 'processing',
    billing: { phone: '+1 (555) 123-4567' },
    date_created_gmt: '2026-03-01T12:00:00',
    line_items: [{ name: 'Mug', quantity: 2, sku: 'MUG' }]
  });
  assert.equal(event.resource, 'order');
  assert.equal(event.externalId, '9001');
  assert.equal(event.phone, '15551234567');
  assert.equal(event.amount, '49.50');
  assert.equal(event.currency, 'USD');
  assert.equal(event.lineItems[0].title, 'Mug');
  assert.match(event.occurredAt, /Z$/);
});

test('WooCommerce checkout.abandoned requires HTTPS checkout URL and open state', () => {
  const event = normalizeProviderEvent('woocommerce', 'checkout.abandoned', {
    id: 'cart_abc',
    cart_total: '19.00',
    currency: 'EUR',
    phone: '4915123456789',
    checkout_url: 'https://store.example/checkout?cart=1',
    date_modified_gmt: '2026-03-02T08:15:00',
    status: 'pending'
  });
  assert.equal(event.resource, 'checkout');
  assert.equal(event.externalId, 'cart_abc');
  assert.equal(event.phone, '4915123456789');
  assert.equal(event.checkoutUrl, 'https://store.example/checkout?cart=1');
  assert.equal(event.terminal, false);
  assert.equal(event.state, 'open');
});

test('WooCommerce rejects private hosts and unsigned topic shapes', () => {
  assert.throws(() => connectorSource('woocommerce', 'https://127.0.0.1/store'), { code: 'CONNECTOR_SOURCE_INVALID' });
  assert.throws(() => normalizeProviderEvent('woocommerce', 'orders/create', { id: 1 }), { code: 'CONNECTOR_EVENT_INVALID' });
});
