import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityImprovementBacklog } from '../lib/improvement-backlog.js';
import { honestLimitsPayload } from '../lib/honest-product-limits.js';
import { workspaceProductionHub } from '../lib/workspace-production-hub.js';

test('production hub honest limits cover all boundary categories', () => {
  const payload = honestLimitsPayload();
  assert.equal(payload.limits.length, 10);
  const ids = new Set(payload.limits.map((l) => l.id));
  assert.ok(ids.has('whatsapp_groups'));
  assert.ok(ids.has('integration_marketplace'));
});

test('strong registry has no improvement backlog and hub uses live production pending', () => {
  const backlog = capabilityImprovementBacklog();
  assert.equal(backlog.length, 0);
  assert.equal(typeof workspaceProductionHub, 'function');
  assert.match(workspaceProductionHub.toString(), /workspaceProductionPending/);
});
