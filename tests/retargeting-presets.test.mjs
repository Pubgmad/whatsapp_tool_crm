import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetargetRules, defaultRetargetingPresetCatalog, listRetargetPresetIds } from '../lib/retargeting-presets.js';

test('retarget presets expose stable ids and compound rules', () => {
  const ids = listRetargetPresetIds();
  assert.ok(ids.includes('read_no_reply'));
  const rules = buildRetargetRules('read_no_reply', 'camp_1');
  assert.equal(rules.engagementMode, 'all');
  assert.equal(rules.engagement.length, 2);
  assert.equal(rules.engagement[0].campaignId, 'camp_1');
});

test('default catalog includes human labels for every preset', () => {
  const catalog = defaultRetargetingPresetCatalog();
  for (const id of listRetargetPresetIds()) {
    assert.ok(catalog[id]?.title, `missing title for ${id}`);
  }
});

test('flow_abandoned preset is accepted by audience rules', () => {
  const rules = buildRetargetRules('flow_abandoned', 'camp_x');
  assert.equal(rules.engagement[0].event, 'flow_abandoned');
});
