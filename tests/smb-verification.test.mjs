import test from 'node:test';
import assert from 'node:assert/strict';
import { matchReplyRule } from '../lib/reply-bots.js';
import { planAllowsFeature, planEntitlementKeys } from '../lib/plan-features.js';
import { builtInSubscriptionPlans } from '../lib/default-plans.js';
import { DEFAULT_PROVIDERS } from '../lib/smb-platform-config.js';
import { ECOMMERCE_PLAYBOOKS } from '../lib/ecommerce-playbooks.js';
import { SIMPLE_MODE_VIEWS } from '../components/workspace/nav-config.js';

test('default plans include SMB entitlement keys by tier', () => {
  const byCode = Object.fromEntries(builtInSubscriptionPlans().map((plan) => [plan.code, plan]));
  for (const code of ['free', 'starter', 'growth', 'professional', 'enterprise']) {
    const keys = planEntitlementKeys(byCode[code].features);
    assert.ok(keys.includes('reply_bots'), `${code} missing reply_bots`);
    assert.ok(keys.includes('sheets_bot'), `${code} missing sheets_bot`);
    assert.ok(keys.includes('assisted_onboarding'), `${code} missing assisted_onboarding`);
    assert.ok(keys.includes('simple_mode'), `${code} missing simple_mode`);
  }
  assert.equal(planAllowsFeature(byCode.growth.features, 'ecommerce_playbooks'), true);
  assert.equal(planAllowsFeature(byCode.free.features, 'ecommerce_playbooks'), false);
  assert.equal(planAllowsFeature(byCode.enterprise.features, 'checkout_recovery'), true);
});

test('marketplace providers expose guided connectors without fake OAuth for Zapier/Pabbly', () => {
  const byId = Object.fromEntries(DEFAULT_PROVIDERS.map((item) => [item.id, item]));
  assert.equal(byId.zapier.kind, 'webhook');
  assert.equal(byId.pabbly.kind, 'webhook');
  assert.equal(byId.zoho_crm.kind, 'oauth');
  assert.equal(byId.google_sheets.kind, 'oauth');
});

test('ecommerce playbooks include shopify and woocommerce recovery', () => {
  const ids = ECOMMERCE_PLAYBOOKS.map((item) => item.id);
  assert.ok(ids.includes('abandoned_checkout_recovery'));
  assert.ok(ids.includes('woo_abandoned_checkout_recovery'));
});

test('simple mode default destinations are focused', () => {
  assert.ok(SIMPLE_MODE_VIEWS.includes('inbox'));
  assert.ok(SIMPLE_MODE_VIEWS.includes('bots'));
  assert.ok(SIMPLE_MODE_VIEWS.includes('onboarding'));
  assert.ok(!SIMPLE_MODE_VIEWS.includes('ads'));
});

test('reply rule matching remains deterministic', () => {
  assert.equal(matchReplyRule({ enabled: true, match_type: 'contains', pattern: 'hours' }, 'What are your hours?'), true);
  assert.equal(matchReplyRule({ enabled: true, match_type: 'exact', pattern: 'hours' }, 'What are your hours?'), false);
});
