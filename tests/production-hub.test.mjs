import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityImprovementBacklog } from '../lib/improvement-backlog.js';
import { honestLimitsPayload } from '../lib/honest-product-limits.js';

test('production hub honest limits cover all boundary categories', () => {
  const payload = honestLimitsPayload();
  assert.equal(payload.limits.length, 6);
  const ids = new Set(payload.limits.map((l) => l.id));
  assert.ok(ids.has('whatsapp_groups'));
  assert.ok(ids.has('integration_marketplace'));
});

test('improvement backlog drives platform section metrics', () => {
  const backlog = capabilityImprovementBacklog();
  assert.ok(backlog.some((item) => item.group === 'core_crm'));
  assert.ok(backlog.some((item) => item.group === 'integrations'));
});
