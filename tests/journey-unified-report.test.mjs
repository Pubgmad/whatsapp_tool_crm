import assert from 'node:assert/strict';
import test from 'node:test';

test('journey unified report module exports', async () => {
  const mod = await import('../lib/journey-unified-report.js');
  assert.equal(typeof mod.journeyUnifiedReport, 'function');
});
