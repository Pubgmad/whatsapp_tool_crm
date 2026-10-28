import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  navGroups,
  productSwitcherIdForView,
  workspaceRoutes,
  workspaceLocation
} from '../components/workspace/nav-config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('analytics secondary nav excludes account admin destinations', () => {
  const insights = navGroups.find((group) => group.id === 'insights');
  const readiness = navGroups.find((group) => group.id === 'readiness');
  const workspaceAdmin = navGroups.find((group) => group.id === 'workspace_admin');
  const subscriptions = navGroups.find((group) => group.id === 'subscriptions');
  const compliance = navGroups.find((group) => group.id === 'compliance');
  assert.ok(insights);
  assert.ok(readiness);
  assert.ok(workspaceAdmin);
  assert.ok(subscriptions);
  assert.ok(compliance);
  assert.deepEqual(
    insights.items.map((item) => item.id),
    ['results', 'meta_analytics', 'conversions', 'journeys']
  );
  assert.deepEqual(readiness.items.map((item) => item.id), ['capabilities', 'groups']);
  assert.deepEqual(workspaceAdmin.items.map((item) => item.id), ['team', 'security']);
  assert.deepEqual(subscriptions.items.map((item) => item.id), ['billing']);
  assert.deepEqual(compliance.items.map((item) => item.id), ['unsubscribes']);
  assert.equal(insights.label, 'Analytics & Insights');
  assert.equal(
    productSwitcherIdForView('meta_analytics', ['results', 'team', 'billing', 'unsubscribes']),
    'results'
  );
  assert.equal(
    productSwitcherIdForView('security', ['results', 'team', 'billing', 'unsubscribes']),
    'team'
  );
  assert.equal(
    productSwitcherIdForView('billing', ['results', 'team', 'billing', 'unsubscribes']),
    'billing'
  );
});

test('meta insights route resolves and page module exists', () => {
  assert.equal(workspaceRoutes.meta_analytics, '/app/settings/whatsapp/analytics');
  assert.equal(workspaceLocation('/app/settings/whatsapp/analytics').view, 'meta_analytics');
  assert.equal(workspaceRoutes.results, '/app/analytics');
  assert.equal(workspaceRoutes.unsubscribes, '/app/suppression');
  assert.equal(workspaceRoutes.team, '/app/team');
  assert.equal(workspaceRoutes.billing, '/app/settings/billing');
  assert.equal(workspaceRoutes.security, '/app/settings/security');
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
