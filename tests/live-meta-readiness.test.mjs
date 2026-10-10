import test from 'node:test';
import assert from 'node:assert/strict';
import { honestLimitById } from '../lib/honest-product-limits.js';

test('honest limits document Meta live and WebView chrome boundaries', () => {
  assert.ok(honestLimitById('in_chat_webview_chrome')?.boundary.includes('Meta'));
  assert.ok(honestLimitById('automation_visual_canvas')?.boundary);
  assert.ok(honestLimitById('meta_live_verification')?.operatorActions?.length);
});

test('normalizeDefinition preserves canvas coordinates', async () => {
  const { normalizeDefinition } = await import('../lib/automation.js');
  const definition = normalizeDefinition({
    startNodeId: 'a',
    nodes: [
      { id: 'a', type: 'message', body: 'Hi', inputKind: 'none', next: 'b', canvasX: 120, canvasY: 96 },
      { id: 'b', type: 'end', body: 'Done', inputKind: 'none', canvasX: 360, canvasY: 96 }
    ]
  });
  assert.equal(definition.nodes[0].canvasX, 120);
  assert.equal(definition.nodes[1].canvasY, 96);
});
