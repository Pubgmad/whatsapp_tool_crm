import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { navGroups, workspaceRoutes, workspaceLocation } from '../components/workspace/nav-config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('analytics secondary nav excludes account admin destinations', () => {
  const insights = navGroups.find((group) => group.id === 'insights');
  const account = navGroups.find((group) => group.id === 'account');
  assert.ok(insights);
  assert.ok(account);
  assert.deepEqual(
    insights.items.map((item) => item.id),
    ['results', 'meta_analytics', 'conversions', 'journeys']
  );
  assert.ok(account.items.some((item) => item.id === 'team'));
  assert.ok(account.items.some((item) => item.id === 'billing'));
  assert.ok(account.items.some((item) => item.id === 'capabilities'));
  assert.equal(insights.label, 'Analytics');
});

test('meta insights route resolves and page module exists', () => {
  assert.equal(workspaceRoutes.meta_analytics, '/app/settings/whatsapp/analytics');
  assert.equal(workspaceLocation('/app/settings/whatsapp/analytics').view, 'meta_analytics');
  assert.equal(workspaceRoutes.results, '/app/analytics');
  assert.ok(existsSync(join(root, 'app/app/settings/whatsapp/analytics/page.js')));
  const page = readFileSync(join(root, 'app/app/settings/whatsapp/analytics/page.js'), 'utf8');
  assert.match(page, /Meta insights/);
});

test('results bundle soft-fails with sectionErrors contract', async () => {
  const source = readFileSync(join(root, 'lib/workspace-results-bundle.js'), 'utf8');
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /sectionErrors/);
  assert.match(source, /campaignSources/);
});
