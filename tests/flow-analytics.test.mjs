import assert from 'node:assert/strict';
import test from 'node:test';

test('flow analytics API route module loads', async () => {
  const mod = await import('../app/api/whatsapp/flow-analytics/route.js');
  assert.equal(typeof mod.GET, 'function');
});
