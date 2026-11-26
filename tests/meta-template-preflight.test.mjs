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
    'Hi {{1}}, thank you for booking with us. Your appointment on {{2}} at {{3}} is confirmed. Please arrive a few minutes early at {{4}}. Reply to this chat if you need to reschedule or cancel.'
  );
  assert.equal(result.variableCount, 4);
  assert.ok(result.fixedWordCount >= 9);
});

test('rejects adjacent variables', () => {
  assert.throws(
    () => assertMetaTemplateBodyRules('Hi {{1}} {{2}}, your order is ready for pickup today at the front desk.'),
    (error) => error.code === 'TEMPLATE_VARIABLE_ADJACENT'
  );
});
