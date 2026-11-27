import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SIMPLE_MODE_VIEWS,
  featureForView,
  navGroups,
  pageTitle,
  workspaceRoutes,
  canOpenWorkspaceView
} from '../components/workspace/nav-config.js';
import { isReleaseFeatureAllowed } from '../lib/release-feature-allowlist.js';
import { mergeCatalogueEntitlements, builtInSubscriptionPlans } from '../lib/default-plans.js';
import { planAllowsFeature } from '../lib/plan-features.js';

test('segments is allowlisted for the WhatsApp Automation release', () => {
  assert.equal(isReleaseFeatureAllowed('segments'), true);
});

test('Audience nav includes Segments beside Contacts and Suppression', () => {
  const audience = navGroups.find((group) => group.id === 'audience');
  assert.ok(audience);
  assert.deepEqual(
    audience.items.map((item) => item.id),
    ['contacts', 'segments', 'unsubscribes']
  );
  assert.equal(workspaceRoutes.segments, '/app/segments');
  assert.equal(pageTitle('segments'), 'Segments');
  assert.equal(featureForView.segments, 'segments');
  assert.ok(SIMPLE_MODE_VIEWS.includes('segments'));
  assert.equal(canOpenWorkspaceView('Manager', 'segments'), true);
});

test('Free catalogue entitlements include segments; Pro includes campaigns', () => {
  const plans = builtInSubscriptionPlans();
  const free = plans.find((plan) => plan.code === 'free');
  const pro = plans.find((plan) => plan.code === 'pro');
  assert.equal(planAllowsFeature(free.features, 'segments'), true);
  assert.equal(planAllowsFeature(free.features, 'inbox'), true);
  assert.equal(planAllowsFeature(free.features, 'campaigns'), false);
  assert.equal(planAllowsFeature(pro.features, 'segments'), true);
  assert.equal(planAllowsFeature(pro.features, 'campaigns'), true);
});

test('mergeCatalogueEntitlements repairs Free plans that only have SMB keys', () => {
  const plans = builtInSubscriptionPlans();
  const free = plans.find((plan) => plan.code === 'free');
  const broken = [
    'Contacts and basic segments',
    'reply_bots',
    'sheets_bot',
    'assisted_onboarding',
    'simple_mode'
  ];
  assert.equal(planAllowsFeature(broken, 'segments'), false);
  const { features, added } = mergeCatalogueEntitlements(broken, free.features);
  assert.ok(added.includes('segments'));
  assert.ok(added.includes('inbox'));
  assert.equal(planAllowsFeature(features, 'segments'), true);
  assert.equal(planAllowsFeature(features, 'inbox'), true);
  assert.ok(features.includes('Contacts and basic segments'));
});
