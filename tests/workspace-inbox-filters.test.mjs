import assert from 'node:assert/strict';
import test from 'node:test';
import { commerceAutomationPreset } from '../lib/commerce-automation-presets.js';

test('commerce automation presets are bounded and typed', () => {
  const preset = commerceAutomationPreset('shopify_payment_reminder');
  assert.equal(preset.eventType, 'whatsapp_order_received');
  assert.equal(preset.unpaidOnly, true);
  assert.equal(commerceAutomationPreset('missing'), null);
  const codFollowUp = commerceAutomationPreset('shopify_cod_non_response');
  assert.equal(codFollowUp.delayMinutes, 180);
  assert.equal(codFollowUp.unpaidOnly, true);
  assert.ok(commerceAutomationPreset('shopify_prepaid_shipped_update'));
});
