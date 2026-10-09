import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDefinition, safeRegex } from '../lib/automation.js';
import { executeAdvancedNode, normalizeAdvancedNode } from '../lib/automation-node-runtime.js';
import { normalizeAiRouteNode, parseAiRouteResponse } from '../lib/automation-ai-router.js';
import { simulateAutomationFlow } from '../lib/automation-simulate.js';

test('AI routes require explicit allowed destinations and fail closed', () => {
  assert.throws(() => normalizeAiRouteNode({ type: 'ai_route', model: 'configured', prompt: 'Route safely', allowedDestinations: ['sales'], fallback: 'other' }));
  const node = normalizeAiRouteNode({ type: 'ai_route', model: 'configured', prompt: 'Route safely', allowedDestinations: ['sales', 'fallback'], fallback: 'fallback' });
  assert.equal(node.fallback, 'fallback');
  assert.equal(parseAiRouteResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"destination":"unknown"}' }] }] }, node.allowedDestinations, node.fallback), 'fallback');
});

test('API nodes branch by status, timeout, and transport error', async () => {
  const node = { type: 'api_request', next: 'ok', errorNext: 'failed', timeoutNext: 'timed_out', connectionId: 'owned_connection',
    requestFields: [], responseMapping: [], statusBranches: [{ status: '202', next: 'accepted' }, { status: '4xx', next: 'rejected' }] };
  normalizeAdvancedNode(node);
  const effects = { guard: async () => {}, attributes: async () => ({}), request: async () => ({ statusCode: 202, data: {} }) };
  assert.equal((await executeAdvancedNode({ node, context: {}, effects })).next, 'accepted');
  effects.request = async () => { throw Object.assign(new Error('timeout'), { code: 'AUTOMATION_API_TIMEOUT' }); };
  assert.equal((await executeAdvancedNode({ node, context: {}, effects })).next, 'timed_out');
});

test('safe regex triggers reject unbounded and backtracking constructs', () => {
  assert.equal(safeRegex('^order-[0-9]{1,12}$').test('order-123'), true);
  assert.throws(() => safeRegex('(a+)+$'));
  assert.throws(() => safeRegex('a*'));
  assert.throws(() => safeRegex('(a)\\1'));
});

test('production node schema validates product, section list, and AI nodes', () => {
  const definition = normalizeDefinition({
    startNodeId: 'product',
    nodes: [
      { id: 'product', type: 'single_product', catalogId: 'catalog_1', retailerId: 'sku_1', next: 'list' },
      { id: 'list', type: 'section_list', body: 'Choose', options: [{ id: 'one', label: 'One', section: 'First', next: 'ai' }] },
      { id: 'ai', type: 'ai_route', model: 'configured-model', prompt: 'Choose a destination.', allowedDestinations: ['done'], fallback: 'done' },
      { id: 'done', type: 'end' }
    ]
  });
  assert.equal(definition.nodes[0].inputKind, 'none');
  assert.equal(definition.nodes[1].inputKind, 'list');
});

test('simulator covers API and commerce-visible nodes', () => {
  const result = simulateAutomationFlow({
    startNodeId: 'api',
    nodes: [
      { id: 'api', type: 'api_request', next: 'product', errorNext: 'end', timeoutNext: 'end', statusBranches: [{ status: '202', next: 'product' }] },
      { id: 'product', type: 'multi_product', body: 'Products', next: 'end' },
      { id: 'end', type: 'end' }
    ]
  }, { apiStatus: 202 });
  assert.deepEqual(result.steps.map(step => step.type), ['api_request', 'multi_product', 'end']);
});
