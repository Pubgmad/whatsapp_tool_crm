import test from 'node:test';
import assert from 'node:assert/strict';
import { templateSendComponents } from '../lib/template-send-components.js';

test('text-only sends remain compatible', () => {
  assert.deepEqual(templateSendComponents(['Ada', 0]), [{ type: 'body', parameters: [{ type: 'text', text: 'Ada' }, { type: 'text', text: '0' }] }]);
  assert.deepEqual(templateSendComponents(), []);
});

test('media headers and dynamic buttons use typed Meta parameters', () => {
  const result = templateSendComponents(['Ada'], {
    header: { type: 'document', id: '123', filename: 'invoice.pdf' },
    buttons: [{ type: 'url', index: 0, value: 'order-123' }, { type: 'quick_reply', index: 1, value: 'confirm' }]
  });
  assert.deepEqual(result[0], { type: 'header', parameters: [{ type: 'document', document: { id: '123', filename: 'invoice.pdf' } }] });
  assert.deepEqual(result[2].parameters, [{ type: 'text', text: 'order-123' }]);
  assert.deepEqual(result[3].parameters, [{ type: 'payload', payload: 'confirm' }]);
});

test('unsafe and ambiguous template input fails before sending', () => {
  for (const parameters of [
    { header: { type: 'image', link: 'http://example.com/a.png' } },
    { header: { type: 'image', id: '123', link: 'https://example.com/a.png' } },
    { header: { type: 'image', id: '../123' } },
    { buttons: [{ type: 'url', index: 0, value: 'a' }, { type: 'url', index: 0, value: 'b' }] },
    { buttons: [{ type: 'unknown', index: 0, value: 'a' }] },
    { carousel: [] }
  ]) assert.throws(() => templateSendComponents([], parameters), { code: 'TEMPLATE_PARAMETERS_INVALID' });
});
