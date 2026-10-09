import assert from 'node:assert/strict';
import test from 'node:test';
import { campaignSourceLabel, campaignSourceOptions } from '../lib/campaign-source-labels.js';

test('campaign source labels cover taxonomy kinds', () => {
  assert.equal(campaignSourceLabel('public_api'), 'Public API campaign');
  assert.equal(campaignSourceLabel('drip'), 'Drip sequence');
  assert.ok(campaignSourceOptions().some((item) => item.id === 'retarget'));
});
