import assert from 'node:assert/strict';
import test from 'node:test';
import { integrationMarketplaceCatalog } from '../lib/integration-marketplace.js';
import { resolveAutomationRoute } from '../lib/automation-ai-router.js';

test('integration marketplace includes expanded recipe catalog', () => {
  const catalog = integrationMarketplaceCatalog();
  assert.ok(catalog.recipes.some((item) => item.id === 'pabbly_webhook'));
  assert.ok(catalog.recipes.some((item) => item.id === 'slack_webhook'));
  assert.equal(catalog.recipes.length >= 6, true);
});

test('campaign drip module exports queue runner', async () => {
  const mod = await import('../lib/campaign-drip.js');
  assert.equal(typeof mod.runCampaignDripQueue, 'function');
  assert.equal(typeof mod.campaignDripRequest, 'function');
});

test('ad optimization suggestions module is wired', async () => {
  const mod = await import('../lib/ad-optimization-suggestions.js');
  assert.equal(typeof mod.listAdOptimizationSuggestions, 'function');
});

test('ai_route is exercised by router helper', () => {
  const definition = {
    startNodeId: 'a',
    nodes: [{ id: 'r', type: 'ai_route', routes: [{ match: ['buy'], next: 'b' }], fallback: 'a' }, { id: 'a', type: 'end' }, { id: 'b', type: 'end' }]
  };
  assert.equal(resolveAutomationRoute(definition, { text: 'I want to buy' }), 'b');
});
