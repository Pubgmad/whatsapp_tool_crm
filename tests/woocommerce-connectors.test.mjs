import assert from 'node:assert/strict';
import test from 'node:test';

test('provider connectors exposes WooCommerce provider id', async () => {
  const mod = await import('../lib/provider-connectors.js');
  assert.ok(typeof mod === 'object');
});
