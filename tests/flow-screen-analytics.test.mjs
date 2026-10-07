import assert from 'node:assert/strict';
import test from 'node:test';
import { flowSessionKey } from '../lib/flow-screen-analytics.js';

test('flowSessionKey accepts flow tokens and rejects malformed values', () => {
  const token = 'a'.repeat(64);
  assert.equal(flowSessionKey(token).length, 32);
  assert.equal(flowSessionKey('short'), '');
  assert.equal(flowSessionKey(''), '');
});
