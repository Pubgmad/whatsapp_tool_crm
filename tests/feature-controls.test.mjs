import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWorkspaceFeature, featureSettingKey, workspaceFeatureFlags, WORKSPACE_FEATURES } from '../lib/feature-controls.js';

test('checkout recovery defaults off before settings are seeded', async () => {
  const flags = await workspaceFeatureFlags(null, async () => ({ rows: [] }));
  assert.deepEqual(Object.keys(flags).sort(), Object.keys(WORKSPACE_FEATURES).sort());
  assert.equal(flags.checkout_recovery, false);
  assert.ok(Object.entries(flags).filter(([name]) => name !== 'checkout_recovery').every(([,enabled]) => enabled));
});

test('checkout recovery requires a global enable and respects tenant disable', async () => {
  const enabled = async sql => sql.includes('FROM businesses')
    ? { rows: [{ feature_overrides: { checkout_recovery: false } }] }
    : { rows: [{ key: featureSettingKey('checkout_recovery'), value: true }] };
  assert.equal((await workspaceFeatureFlags(null, enabled)).checkout_recovery, true);
  assert.equal((await workspaceFeatureFlags('company', enabled)).checkout_recovery, false);
});

test('disabled feature is not available to workspace or route guard', async () => {
  const run = async () => ({ rows: [{ key: featureSettingKey('ads'), value: false }] });
  const flags = await workspaceFeatureFlags(null, run);
  assert.equal(flags.ads, false);
  assert.equal(flags.calling, true);
  await assert.rejects(assertWorkspaceFeature('ads', null, run), error => error.code === 'FEATURE_DISABLED' && error.status === 403);
});

test('unknown feature keys fail closed', async () => {
  await assert.rejects(assertWorkspaceFeature('unknown', null, async () => ({ rows: [] })), error => error.code === 'FEATURE_UNKNOWN');
});

test('tenant disable wins locally and cannot override a global disable', async () => {
  const run = async sql => sql.includes('FROM businesses')
    ? { rows: [{ feature_overrides: { calling: false, ads: true } }] }
    : { rows: [{ key: featureSettingKey('ads'), value: false }] };
  const flags = await workspaceFeatureFlags('business-1', run);
  assert.equal(flags.calling, false);
  assert.equal(flags.ads, false);
  assert.equal(flags.commerce, true);
  await assert.rejects(assertWorkspaceFeature('calling', 'business-1', run), error => error.code === 'FEATURE_DISABLED');
});
