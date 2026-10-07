import assert from 'node:assert/strict';
import test from 'node:test';

test('ai safety dashboard helper is exported', async () => {
  const mod = await import('../lib/ai-safety-events.js');
  assert.equal(typeof mod.aiSafetyDashboard, 'function');
});
