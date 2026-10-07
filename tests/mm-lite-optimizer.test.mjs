import assert from 'node:assert/strict';
import test from 'node:test';

test('mm lite optimizer exports workspace report helper', async () => {
  const mod = await import('../lib/mm-lite-optimizer.js');
  assert.equal(typeof mod.workspaceMmLiteOptimizerReport, 'function');
});
