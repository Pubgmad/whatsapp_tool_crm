import assert from 'node:assert/strict';
import test from 'node:test';

test('conversationHandoffTimeline is exported', async () => {
  const mod = await import('../lib/conversation-handoff.js');
  assert.equal(typeof mod.conversationHandoffTimeline, 'function');
});
