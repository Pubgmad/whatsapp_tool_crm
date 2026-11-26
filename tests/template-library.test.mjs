import test from 'node:test';
import assert from 'node:assert/strict';

test('template library server helpers are loadable', async () => {
  const mod = await import('../lib/template-library.js');
  assert.ok(mod);
});