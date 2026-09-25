import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSubscriptionActive, limitReached } from '../lib/limits.js';

test('subscription gate rejects expired and unpaid workspaces when enabled', () => {
  const previous = process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED;
  try {
    process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED = 'true';
    assert.throws(() => assertSubscriptionActive({ status: 'past_due' }), { code: 'SUBSCRIPTION_INACTIVE' });
    assert.throws(() => assertSubscriptionActive({ status: 'trialing', trialEndsAt: new Date(Date.now() - 1000) }), { code: 'SUBSCRIPTION_INACTIVE' });
    assert.doesNotThrow(() => assertSubscriptionActive({ status: 'active', periodEnd: new Date(Date.now() + 60000) }));
    assert.doesNotThrow(() => assertSubscriptionActive({ status: 'review', reviewAccess: true }));
  } finally {
    if (previous === undefined) delete process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED;
    else process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED = previous;
  }
});

test('capacity errors occur at configured plan limits', () => {
  assert.equal(limitReached('Message', 10, 9), null);
  assert.equal(limitReached('Message', null, 1000), null);
  assert.equal(limitReached('Message', 10, 10)?.code, 'SUBSCRIPTION_LIMIT_REACHED');
});
