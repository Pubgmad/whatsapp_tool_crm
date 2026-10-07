import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateAutomationFlow } from '../lib/automation-simulate.js';

test('simulateAutomationFlow follows keyword branch', () => {
  const result = simulateAutomationFlow({
    startNodeId: 'start',
    nodes: [
      { id: 'start', type: 'question', body: 'Pick', inputKind: 'buttons', options: [{ id: 'a', label: 'A', next: 'end_a' }, { id: 'b', label: 'B', next: 'end_b' }] },
      { id: 'end_a', type: 'message', body: 'Path A', inputKind: 'none', next: '' },
      { id: 'end_b', type: 'message', body: 'Path B', inputKind: 'none', next: '' }
    ]
  }, { text: 'b' });
  assert.equal(result.steps.at(-1)?.body, 'Path B');
});
