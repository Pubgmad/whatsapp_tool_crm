import assert from 'node:assert/strict';
import test from 'node:test';

test('slo certification exports report helper', async () => {
  const mod = await import('../lib/slo-certification.js');
  assert.equal(typeof mod.computePlatformSloCertification, 'function');
});
