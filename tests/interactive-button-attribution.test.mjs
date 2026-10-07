import assert from 'node:assert/strict';
import test from 'node:test';
import { recordInteractiveButtonAttribution } from '../lib/interactive-button-attribution.js';

test('recordInteractiveButtonAttribution rejects empty payloads', async () => {
  const calls = [];
  const client = { query: async (...args) => { calls.push(args); return { rows: [] }; } };
  assert.equal(await recordInteractiveButtonAttribution(client, { businessId: 'b', contactId: 'c', messageId: 'm', buttonId: '' }), false);
  assert.equal(calls.length, 0);
});

test('recordInteractiveButtonAttribution writes interactive_button_reply event', async () => {
  const client = { query: async () => ({ rows: [] }) };
  assert.equal(
    await recordInteractiveButtonAttribution(client, {
      businessId: 'biz',
      contactId: 'con',
      messageId: 'msg',
      buttonId: 'cta_1',
      title: 'Buy now',
      kind: 'button_reply'
    }),
    true
  );
});
