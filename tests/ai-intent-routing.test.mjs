import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIntentRoutes } from '../lib/ai-intent-routing.js';
import { compileFlowDesign } from '../lib/flow-design.js';

test('normalizeIntentRoutes keeps valid team assignments', () => {
  const routes = normalizeIntentRoutes({ support: 'user_support_lead', booking: '', order: 'user_order_lead' });
  assert.deepEqual(routes, { support: 'user_support_lead', order: 'user_order_lead' });
});

test('compileFlowDesign emits routing_model for branch rules', () => {
  const flow = compileFlowDesign({
    version: '7.0',
    screens: [
      { id: 'START', title: 'Start', submitLabel: 'Next', fields: [{ name: 'path', label: 'Path', type: 'radio', required: true, options: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }], branchField: 'path', branchRules: [{ equals: 'a', nextScreen: 'PATH_A' }, { equals: 'b', nextScreen: 'PATH_B' }] },
      { id: 'PATH_A', title: 'A', submitLabel: 'Done', fields: [{ name: 'note_a', label: 'Note', type: 'text', required: false }] },
      { id: 'PATH_B', title: 'B', submitLabel: 'Done', fields: [{ name: 'note_b', label: 'Note', type: 'text', required: false }] }
    ]
  });
  assert.ok(flow.routing_model?.START?.includes('PATH_A'));
  assert.equal(flow.screens.length, 3);
});
