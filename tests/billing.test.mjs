import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutPriceVersion } from '../lib/billing.js';

test('checkout idempotency changes when a Super Admin changes the plan price', () => {
  const plan = { id: 'plan_1', currency: 'INR', updated_at: '2026-09-25T00:00:00Z' };
  const original = checkoutPriceVersion(plan, 'monthly', 99900);
  assert.notEqual(original, checkoutPriceVersion(plan, 'monthly', 149900));
  assert.notEqual(original, checkoutPriceVersion({ ...plan, currency: 'USD' }, 'monthly', 99900));
  assert.equal(original, checkoutPriceVersion(plan, 'monthly', 99900));
});
