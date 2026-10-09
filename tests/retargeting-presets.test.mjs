import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRetargetRules, defaultRetargetingPresetCatalog, listRetargetPresetIds } from '../lib/retargeting-presets.js';

function engagementGroup(rules) {
  return rules.root.children.find((node) => node.type === 'group' && node.children.every((child) => child.type === 'engagement'));
}

test('retarget presets expose stable ids and compound rules', () => {
  const ids = listRetargetPresetIds();
  assert.ok(ids.includes('read_no_reply'));
  const rules = buildRetargetRules('read_no_reply', 'camp_1');
  assert.equal(rules.version, 2);
  const engagement = engagementGroup(rules);
  assert.equal(engagement.operator, 'and');
  assert.equal(engagement.children.length, 2);
  assert.equal(engagement.children[0].campaignId, 'camp_1');
});

test('default catalog includes human labels for every preset', () => {
  const catalog = defaultRetargetingPresetCatalog();
  for (const id of listRetargetPresetIds()) {
    assert.ok(catalog[id]?.title, `missing title for ${id}`);
  }
});

test('flow_abandoned preset is accepted by audience rules', () => {
  const rules = buildRetargetRules('flow_abandoned', 'camp_x');
  assert.equal(engagementGroup(rules).children[0].event, 'flow_abandoned');
});
