import test from 'node:test';
import assert from 'node:assert/strict';

test('automation flow generator module is loadable', async () => {
  const mod = await import('../lib/automation-flow-generator.js');
  assert.equal(typeof mod.generateAutomationFlow, 'function');
});