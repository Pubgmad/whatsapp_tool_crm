import assert from 'node:assert/strict';
import test from 'node:test';
import { orderAttributionConfidence } from '../lib/attribution-confidence.js';

test('orderAttributionConfidence labels evidence tiers', () => {
  assert.equal(orderAttributionConfidence({ campaign_id: 'c1', referral: { source_id: 'ad' } }).level, 'high');
  assert.equal(orderAttributionConfidence({ campaign_id: 'c1', referral: { sourceId: 'ad', ctwaClid: 'x' } }).level, 'high');
  assert.equal(orderAttributionConfidence({ campaign_id: 'c1' }).level, 'medium');
  assert.equal(orderAttributionConfidence({ referral: { sourceType: 'AD' } }).level, 'medium');
  assert.equal(orderAttributionConfidence({}).level, 'unknown');
});
