import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FREE_PLAN_CODE,
  builtInSubscriptionPlans,
  isFreeForeverPlan,
  subscriptionFieldsForPlan
} from '../lib/default-plans.js';

test('built-in catalogue includes visible Free Forever and hidden draft paid tiers', () => {
  const plans = builtInSubscriptionPlans();
  const free = plans.find((plan) => plan.code === DEFAULT_FREE_PLAN_CODE);
  assert.ok(free);
  assert.equal(free.visible, true);
  assert.equal(free.monthly_price_cents, 0);
  assert.ok(plans.some((plan) => plan.code === 'basic' && plan.visible === false));
  assert.ok(plans.some((plan) => plan.code === 'enterprise' && plan.visible === false));
});

test('subscriptionFieldsForPlan provisions Free Forever as active without trial expiry', () => {
  const free = builtInSubscriptionPlans().find((plan) => plan.code === 'free');
  const fields = subscriptionFieldsForPlan({ ...free, id: 'plan_free' });
  assert.equal(fields.status, 'active');
  assert.equal(fields.trialEndsAt, null);
  assert.equal(fields.periodEnd, null);
  assert.ok(isFreeForeverPlan(free));
});

test('subscriptionFieldsForPlan keeps pending when no plan exists', () => {
  assert.deepEqual(subscriptionFieldsForPlan(null).status, 'pending');
});
