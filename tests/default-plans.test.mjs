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

test('built-in catalogue publishes Free Forever and paid tiers with a 12% annual discount', () => {
  const plans = builtInSubscriptionPlans();
  const free = plans.find((plan) => plan.code === DEFAULT_FREE_PLAN_CODE);
  assert.ok(free);
  assert.equal(free.visible, true);
  assert.equal(free.monthly_price_cents, 0);
  assert.equal(free.commercial_status, 'published');

  const starter = plans.find((plan) => plan.code === 'starter');
  assert.ok(starter);
  assert.equal(starter.visible, true);
  assert.equal(starter.commercial_status, 'published');
  assert.equal(starter.monthly_price_cents, PROPOSED_PLAN_PRICES_INR.starter * 100);
  assert.equal(starter.yearly_price_cents, annualCents(PROPOSED_PLAN_PRICES_INR.starter));
  assert.equal(starter.yearly_price_cents, 1054900);

  const growth = plans.find((plan) => plan.code === 'growth');
  assert.equal(growth.monthly_price_cents, PROPOSED_PLAN_PRICES_INR.growth * 100);
  assert.equal(growth.yearly_price_cents, annualCents(PROPOSED_PLAN_PRICES_INR.growth));
  assert.equal(growth.yearly_price_cents, 2638900);
  assert.equal(growth.is_popular, true);
  assert.equal(growth.visible, true);
  assert.equal(growth.commercial_status, 'published');

  const professional = plans.find((plan) => plan.code === 'professional');
  assert.equal(professional.monthly_price_cents, PROPOSED_PLAN_PRICES_INR.professional * 100);
  assert.equal(professional.yearly_price_cents, annualCents(PROPOSED_PLAN_PRICES_INR.professional));
  assert.equal(professional.yearly_price_cents, 6334900);
  assert.equal(professional.visible, true);
  assert.equal(professional.commercial_status, 'published');

  const enterprise = plans.find((plan) => plan.code === 'enterprise');
  assert.equal(enterprise.visible, true);
  assert.equal(enterprise.commercial_status, 'published');
  assert.equal(enterprise.monthly_price_cents, PROPOSED_PLAN_PRICES_INR.enterprise * 100);
  assert.equal(enterprise.yearly_price_cents, annualCents(PROPOSED_PLAN_PRICES_INR.enterprise));
  assert.equal(enterprise.yearly_price_cents, 15840000);

  assert.ok(free.features.includes('inbox'));
  assert.ok(free.features.some((item) => item.includes('Shared inbox')));
  assert.ok(!planAllowsFeature(free.features, 'campaigns'));
  assert.ok(planAllowsFeature(starter.features, 'campaigns'));
});

test('plan entitlement helpers separate keys from marketing bullets', () => {
  const free = builtInSubscriptionPlans().find((plan) => plan.code === 'free');
  const keys = planEntitlementKeys(free.features);
  assert.ok(keys.includes('inbox'));
  assert.ok(!keys.some((key) => key.includes(' ')));
  assert.ok(planMarketingFeatures(free.features).length > 0);
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

test('paid plans include trial days for activation', () => {
  const starter = builtInSubscriptionPlans().find((plan) => plan.code === 'starter');
  const fields = subscriptionFieldsForPlan({ ...starter, id: 'plan_starter' });
  assert.equal(fields.status, 'trialing');
  assert.ok(fields.trialEndsAt);
});
