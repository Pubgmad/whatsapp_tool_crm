import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDefinition, safeRegex } from '../lib/automation.js';
import { normalizeFormSchema } from '../lib/webview-form-submissions.js';

test('regex triggers accept bounded patterns and reject catastrophic ones', () => {
  assert.ok(safeRegex('hello').test('hello world'));
  assert.throws(() => safeRegex('(a+)+'), { code: 'VALIDATION_ERROR' });
  assert.throws(() => safeRegex('a{1,999}'), { code: 'VALIDATION_ERROR' });
});

test('automation definition validates native Flow and hosted page nodes', () => {
  const definition = normalizeDefinition({
    startNodeId: 'start',
    nodes: [
      {
        id: 'start',
        type: 'send_native_flow',
        nativeFlowId: 'waf_1234567890abcdef',
        ctaLabel: 'Book',
        expiresHours: 12,
        next: 'page'
      },
      {
        id: 'page',
        type: 'send_webview_cta',
        webviewId: 'wv_1234567890abcdef',
        waitForCompletion: false,
        next: 'done'
      },
      { id: 'done', type: 'end', inputKind: 'none' }
    ]
  });
  assert.equal(definition.nodes[0].type, 'send_native_flow');
  assert.equal(definition.nodes[0].inputKind, 'none');
  assert.equal(definition.nodes[1].webviewId, 'wv_1234567890abcdef');
  assert.throws(() => normalizeDefinition({
    startNodeId: 'start',
    nodes: [{ id: 'start', type: 'send_native_flow', inputKind: 'none' }]
  }), { code: 'VALIDATION_ERROR' });
});

test('hosted form schema normalizes unique keys and rejects empties', () => {
  const fields = normalizeFormSchema([
    { label: 'Full Name', key: 'Full Name', type: 'text', required: true },
    { label: 'Email', type: 'email', required: true }
  ]);
  assert.deepEqual(fields.map((item) => item.key), ['full_name', 'email']);
  assert.throws(() => normalizeFormSchema([{ label: 'A' }, { label: 'A' }]), { code: 'WEBVIEW_FORM_INVALID' });
});
