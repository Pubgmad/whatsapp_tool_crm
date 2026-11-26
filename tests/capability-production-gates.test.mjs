import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCT_CAPABILITIES } from '../lib/product-capability-registry-data.js';
import { certifyAllProductCapabilities } from '../lib/capability-production-gates.js';

test('all product capabilities are strong and production-gated', () => {
  const count = PRODUCT_CAPABILITIES.length;
  assert.ok(count >= 1);
  assert.ok(PRODUCT_CAPABILITIES.every((item) => item.codeStatus === 'strong'));
  const report = certifyAllProductCapabilities();
  assert.equal(report.strong, count);
  if (!report.pass) {
    const detail = report.failures.map((item) => `${item.id}: ${item.failures.join('; ')}`).join('\n');
    assert.fail(`Capability production gates failed:\n${detail}`);
  }
});
