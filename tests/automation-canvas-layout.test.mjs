import test from 'node:test';
import assert from 'node:assert/strict';
import {
  autoLayoutNodes,
  collectEdges,
  ensureNodePositions,
  snapToGrid
} from '../lib/automation-canvas-layout.js';

test('snapToGrid rounds to canvas grid', () => {
  assert.equal(snapToGrid(50), 48);
  assert.equal(snapToGrid(60), 72);
});

test('ensureNodePositions fills missing coordinates', () => {
  const nodes = ensureNodePositions([{ id: 'a', type: 'message' }, { id: 'b', type: 'end' }]);
  assert.equal(nodes[0].canvasX, 48);
  assert.ok(Number.isFinite(nodes[1].canvasY));
});

test('collectEdges includes next and option branches', () => {
  const edges = collectEdges([
    { id: 'a', next: 'b', options: [{ id: 'o1', label: 'Yes', next: 'c' }] },
    { id: 'b', next: '' },
    { id: 'c', next: '' }
  ]);
  assert.equal(edges.length, 2);
  assert.ok(edges.some((edge) => edge.kind === 'next'));
  assert.ok(edges.some((edge) => edge.kind === 'option'));
});

test('autoLayoutNodes spreads by graph depth', () => {
  const laid = autoLayoutNodes([
    { id: 'start', next: 'mid', canvasX: 0, canvasY: 0 },
    { id: 'mid', next: 'end', canvasX: 0, canvasY: 0 },
    { id: 'end', canvasX: 0, canvasY: 0 }
  ]);
  assert.ok(laid.find((n) => n.id === 'mid').canvasX > laid.find((n) => n.id === 'start').canvasX);
  assert.ok(laid.find((n) => n.id === 'end').canvasX > laid.find((n) => n.id === 'mid').canvasX);
});
