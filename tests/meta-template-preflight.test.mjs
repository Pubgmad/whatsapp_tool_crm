import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMetaTemplateBodyRules } from '../lib/meta-template-preflight.js';

test('rejects short multi-variable appointment copy', () => {
  assert.throws(
    () => assertMetaTemplateBodyRules('Hi {{1}}, your appointment on {{2}} at {{3}} is confirmed. Location: {{4}}.'),
    (error) => error.code === 'TEMPLATE_VARIABLE_AT_END' || error.code === 'TEMPLATE_VARIABLE_RATIO'
  );
});

test('accepts lengthened appointment copy', () => {
  const result = assertMetaTemplateBodyRules(
    'Hi {{1}}, thank you for booking with us. Your appointment is confirmed for {{2}}. Please arrive a few minutes early at {{3}}. If you need to reschedule or cancel, reply to this chat and our team will help you.'
  );
  assert.equal(result.variableCount, 3);
  assert.ok(result.fixedWordCount >= 14);
});

test('rejects adjacent variables', () => {
  assert.throws(
    () => assertMetaTemplateBodyRules('Hi {{1}} {{2}}, your order is ready for pickup today at the front desk.'),
    (error) => error.code === 'TEMPLATE_VARIABLE_ADJACENT'
  );
});
