import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWorkspaceFeature, featureSettingKey, workspaceFeatureFlags, WORKSPACE_FEATURES, planAllowsFeature, resolveFeatureGate } from '../lib/feature-controls.js';

function mockRun({ platformRows = [], overrides = {}, planFeatures = [] } = {}) {
  return async (sql) => {
    if (sql.includes('subscription_plans')) return { rows: [{ features: planFeatures }] };
    if (sql.includes('FROM businesses')) return { rows: [{ feature_overrides: overrides }] };
    if (sql.includes('platform_settings')) return { rows: platformRows };
    return { rows: [] };
  };
}

test('checkout recovery and whatsapp groups default off before settings are seeded', async () => {
  const flags = await workspaceFeatureFlags(null, async () => ({ rows: [] }));
  assert.deepEqual(Object.keys(flags).sort(), Object.keys(WORKSPACE_FEATURES).sort());
  assert.equal(flags.checkout_recovery, false);
  assert.equal(flags.whatsapp_groups, false);
  const defaultOff = new Set(['checkout_recovery', 'whatsapp_groups']);
  assert.ok(Object.entries(flags).filter(([name]) => !defaultOff.has(name)).every(([, enabled]) => enabled));
});

test('checkout recovery requires a global enable and respects tenant disable', async () => {
  const enabled = mockRun({
    platformRows: [{ key: featureSettingKey('checkout_recovery'), value: true }],
    overrides: { checkout_recovery: false }
  });
  assert.equal((await workspaceFeatureFlags(null, enabled)).checkout_recovery, true);
  assert.equal((await workspaceFeatureFlags('company', enabled)).checkout_recovery, false);
});

test('disabled feature is not available to workspace or route guard', async () => {
  const run = mockRun({ platformRows: [{ key: featureSettingKey('ads'), value: false }] });
  const flags = await workspaceFeatureFlags(null, run);
  assert.equal(flags.ads, false);
  assert.equal(flags.calling, true);
  await assert.rejects(assertWorkspaceFeature('ads', null, run), error => error.code === 'FEATURE_DISABLED' && error.status === 403);
});

test('unknown feature keys fail closed', async () => {
  await assert.rejects(assertWorkspaceFeature('unknown', null, async () => ({ rows: [] })), error => error.code === 'FEATURE_UNKNOWN');
});

test('tenant disable wins locally and cannot override a global disable', async () => {
  const run = mockRun({
    platformRows: [{ key: featureSettingKey('ads'), value: false }],
    overrides: { calling: false, ads: true }
  });
  const flags = await workspaceFeatureFlags('business-1', run);
  assert.equal(flags.calling, false);
  assert.equal(flags.ads, false);
  assert.equal(flags.commerce, true);
  await assert.rejects(assertWorkspaceFeature('calling', 'business-1', run), error => error.code === 'FEATURE_DISABLED');
});

test('plan entitlements further restrict platform-enabled features', async () => {
  assert.equal(planAllowsFeature([], 'calling'), true);
  assert.equal(planAllowsFeature(['inbox', 'calling'], 'calling'), true);
  assert.equal(planAllowsFeature(['inbox'], 'calling'), false);
  assert.equal(resolveFeatureGate({ platformEnabled: true, planAllows: true, tenantOverride: null }), true);
  assert.equal(resolveFeatureGate({ platformEnabled: true, planAllows: false, tenantOverride: true }), false);
  assert.equal(resolveFeatureGate({ platformEnabled: false, planAllows: true, tenantOverride: true }), false);

  const previous = process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED;
  process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED = 'true';
  try {
    const run = mockRun({ planFeatures: ['inbox', 'templates'] });
    const flags = await workspaceFeatureFlags('business-plan', run);
    assert.equal(flags.inbox, true);
    assert.equal(flags.calling, false);
    assert.equal(flags.whatsapp_groups, false);
    assert.equal(flags.checkout_recovery, false);
  } finally {
    if (previous === undefined) delete process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED;
    else process.env.SUBSCRIPTION_ENFORCEMENT_ENABLED = previous;
  }
});
