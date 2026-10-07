import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshRetargetSegmentRules } from '../lib/retargeting-segment-refresh.js';

test('retarget segment refresh rebuilds rules from preset metadata', async () => {
  const updates = [];
  const client = {
    query: async (text, params) => {
      updates.push({ text, params });
      return { rows: [] };
    }
  };
  const result = await refreshRetargetSegmentRules(client, 'biz_1', {
    id: 'seg_1',
    retarget_preset_id: 'read_no_reply',
    retarget_source_campaign_id: 'camp_9'
  });
  assert.equal(result.refreshed, true);
  assert.equal(result.rules.engagement.length, 2);
  assert.match(updates[0].text, /UPDATE audience_segments/);
  const stored = JSON.parse(updates[0].params[0]);
  assert.equal(stored.engagement[0].campaignId, 'camp_9');
});

test('non-retarget segments skip refresh', async () => {
  const result = await refreshRetargetSegmentRules({ query: async () => ({ rows: [] }) }, 'biz', { id: 's1' });
  assert.equal(result.refreshed, false);
});
