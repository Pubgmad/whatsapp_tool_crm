import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAutomationRoute } from '../lib/automation-ai-router.js';

test('resolveAutomationRoute matches keywords and handoff intent', () => {
  const definition = {
    startNodeId: 'start',
    nodes: [
      {
        id: 'router',
        type: 'ai_route',
        routes: [{ match: ['pricing', 'price'], next: 'sales' }],
        fallback: 'start',
        intent: 'handoff',
        handoffNext: 'human'
      },
      { id: 'start', type: 'message', next: 'end' },
      { id: 'sales', type: 'message', next: 'end' },
      { id: 'human', type: 'handoff' },
      { id: 'end', type: 'end' }
    ]
  };
  assert.equal(resolveAutomationRoute(definition, { text: 'What is your pricing?' }), 'sales');
  assert.equal(resolveAutomationRoute(definition, { text: 'I need a human agent' }), 'human');
  assert.equal(resolveAutomationRoute(definition, { text: 'hello' }), 'start');
});
