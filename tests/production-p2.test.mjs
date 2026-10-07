import assert from 'node:assert/strict';
import test from 'node:test';
import { adObjectiveCatalog, normalizeAdObjectiveKind } from '../lib/whatsapp-ad-objectives.js';
import { integrationMarketplaceCatalog } from '../lib/integration-marketplace.js';
import { A11Y_E2E_PROJECTS } from '../lib/a11y-certification.js';

test('adObjectiveCatalog includes lead and website objectives', () => {
  const catalog = adObjectiveCatalog();
  assert.ok(catalog.supported.some((item) => item.id === 'LEAD_GENERATION'));
  assert.ok(catalog.supported.some((item) => item.id === 'WEBSITE_TRAFFIC'));
  assert.equal(normalizeAdObjectiveKind('website_traffic'), 'WEBSITE_TRAFFIC');
  assert.equal(normalizeAdObjectiveKind('unknown'), 'MESSAGES');
});

test('integration marketplace exposes automation recipes', () => {
  const catalog = integrationMarketplaceCatalog();
  assert.ok(catalog.recipes.some((item) => item.id === 'zapier_webhook'));
  assert.ok(catalog.connectors.some((item) => item.id === 'zapier'));
});

test('a11y certification tracks multi-browser matrix', () => {
  assert.equal(A11Y_E2E_PROJECTS.length, 5);
});

test('improvement backlog lists partial capabilities', async () => {
  const { capabilityImprovementBacklog, improvementBacklogSummary } = await import('../lib/improvement-backlog.js');
  const backlog = capabilityImprovementBacklog();
  const summary = improvementBacklogSummary(backlog);
  assert.ok(summary.total >= 40);
  assert.ok(summary.byStatus.partial > 0);
  assert.ok(backlog.some((item) => item.id === 'multi_agent'));
});

test('honest limits registry documents six boundaries', async () => {
  const { HONEST_PRODUCT_LIMITS } = await import('../lib/honest-product-limits.js');
  assert.equal(HONEST_PRODUCT_LIMITS.length, 6);
});
