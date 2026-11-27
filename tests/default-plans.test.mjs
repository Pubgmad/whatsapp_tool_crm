import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FREE_PLAN_CODE,
  PROPOSED_PLAN_PRICES_INR,
  builtInSubscriptionPlans,
  isFreeForeverPlan,
  subscriptionFieldsForPlan
} from '../lib/default-plans.js';
import { planAllowsFeature, planEntitlementKeys, planMarketingFeatures } from '../lib/plan-features.js';

function annualCents(monthlyInr) {
  return Math.round(monthlyInr * 12 * 0.88) * 100;
}

test('built-in catalogue publishes Free/Pro/Custom and archives legacy tiers', () => {
  const plans = builtInSubscriptionPlans();
  const free = plans.find((plan) => plan.code === DEFAULT_FREE_PLAN_CODE);
  assert.ok(free);
  assert.equal(free.name, 'Free');
  assert.equal(free.visible, true);
  assert.equal(free.monthly_price_cents, 0);
  assert.equal(free.commercial_status, 'published');
  assert.equal(free.contact_limit, 250);
  assert.equal(free.automation_flow_limit, 2);

  const pro = plans.find((plan) => plan.code === 'pro');
  assert.ok(pro);
  assert.equal(pro.visible, true);
  assert.equal(pro.is_popular, true);
  assert.equal(pro.monthly_price_cents, PROPOSED_PLAN_PRICES_INR.pro * 100);
  assert.equal(pro.yearly_price_cents, annualCents(PROPOSED_PLAN_PRICES_INR.pro));
  assert.ok(planAllowsFeature(pro.features, 'campaigns'));

  const custom = plans.find((plan) => plan.code === 'custom');
  assert.ok(custom);
  assert.equal(custom.visible, true);
  assert.equal(custom.contact_limit, null);
  assert.ok(planAllowsFeature(custom.features, 'automation'));

  for (const code of ['starter', 'growth', 'professional', 'enterprise']) {
    const legacy = plans.find((plan) => plan.code === code);
    assert.ok(legacy, code);
    assert.equal(legacy.visible, false);
    assert.equal(legacy.commercial_status, 'archived');
  }

  assert.ok(free.features.includes('inbox'));
  assert.ok(!planAllowsFeature(free.features, 'campaigns'));
  assert.ok(planAllowsFeature(pro.features, 'campaigns'));
});

test('plan entitlement helpers separate keys from marketing bullets', () => {
  const free = builtInSubscriptionPlans().find((plan) => plan.code === 'free');
  const keys = planEntitlementKeys(free.features);
  assert.ok(keys.includes('inbox'));
  assert.ok(!keys.some((key) => key.includes(' ')));
  assert.ok(planMarketingFeatures(free.features).length > 0);
});

test('subscriptionFieldsForPlan provisions Free as active without trial expiry', () => {
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

test('paid plans include trial days for activation', () => {
  const pro = builtInSubscriptionPlans().find((plan) => plan.code === 'pro');
  assert.ok(pro.trial_days > 0);
  const fields = subscriptionFieldsForPlan({ ...pro, id: 'plan_pro' });
  assert.equal(fields.status, 'trialing');
  assert.ok(fields.trialEndsAt);
});
