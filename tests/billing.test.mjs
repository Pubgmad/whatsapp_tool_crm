import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutPriceVersion, receiveStripeWebhook } from '../lib/billing.js';

test('checkout idempotency changes when a Super Admin changes the plan price', () => {
  const plan = { id: 'plan_1', currency: 'INR', updated_at: '2026-09-25T00:00:00Z' };
  const original = checkoutPriceVersion(plan, 'monthly', 99900);
  assert.notEqual(original, checkoutPriceVersion(plan, 'monthly', 149900));
  assert.notEqual(original, checkoutPriceVersion({ ...plan, currency: 'USD' }, 'monthly', 99900));
  assert.equal(original, checkoutPriceVersion(plan, 'monthly', 99900));
});

test('Stripe webhook rejects missing and invalid signatures before touching the database', async () => {
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    process.env.STRIPE_SECRET_KEY = 'sk_test_local_verification_only';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_local_verification_only';
    const unsigned = await receiveStripeWebhook(new Request('https://crm.example/api/webhooks/stripe', {
      method: 'POST', body: '{"id":"evt_test"}'
    }));
    assert.equal(unsigned.status, 400);
    assert.equal((await unsigned.json()).code, 'STRIPE_SIGNATURE_MISSING');

    const invalid = await receiveStripeWebhook(new Request('https://crm.example/api/webhooks/stripe', {
      method: 'POST', body: '{"id":"evt_test"}', headers: { 'stripe-signature': 't=1,v1=wrong' }
    }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'STRIPE_SIGNATURE_INVALID');
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});
