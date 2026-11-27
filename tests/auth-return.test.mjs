import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_POST_AUTH_PATH,
  DEFAULT_WORKSPACE_PATH,
  resolveLaunchCta,
  safeAuthReturnPath,
  withAuthReturn,
  workspacePathForPublicHref,
  workspacePathForSlug
} from '../lib/auth-return.js';
import { PRICING_ARCHITECTURE } from '../lib/pricing-architecture.js';

test('Open workspace destination is Meta setup, not inbox or billing', () => {
  assert.equal(DEFAULT_WORKSPACE_PATH, '/app/settings/whatsapp');
  assert.notEqual(DEFAULT_WORKSPACE_PATH, '/app/inbox');
  assert.notEqual(DEFAULT_WORKSPACE_PATH, '/app/settings/billing');
  assert.equal(DEFAULT_POST_AUTH_PATH, '/');
});

test('safeAuthReturnPath defaults to root and blocks open redirects', () => {
  assert.equal(safeAuthReturnPath(''), DEFAULT_POST_AUTH_PATH);
  assert.equal(safeAuthReturnPath('/'), '/');
  assert.equal(safeAuthReturnPath('/app/calling'), DEFAULT_WORKSPACE_PATH);
  assert.equal(safeAuthReturnPath('/app/ads'), DEFAULT_WORKSPACE_PATH);
  assert.equal(safeAuthReturnPath('/app/dashboard'), '/app/dashboard');
  assert.equal(safeAuthReturnPath('/app/settings/whatsapp'), '/app/settings/whatsapp');
  assert.equal(safeAuthReturnPath('https://evil.example'), '/');
  assert.equal(safeAuthReturnPath('//evil.example'), '/');
  assert.equal(safeAuthReturnPath('/super-admin'), '/');
  assert.equal(safeAuthReturnPath('/api/auth/login'), '/');
  assert.equal(safeAuthReturnPath('/login'), '/');
  assert.equal(safeAuthReturnPath('/app/unknown-module'), DEFAULT_WORKSPACE_PATH);
});

test('withAuthReturn preserves query params and next destination', () => {
  assert.equal(withAuthReturn('/login', '/app/inbox'), '/login?next=%2Fapp%2Finbox');
  assert.equal(
    withAuthReturn('/api/auth/google/start?mode=signin', '/app/automations'),
    '/api/auth/google/start?mode=signin&next=%2Fapp%2Fautomations'
  );
  assert.equal(withAuthReturn('/login', '/'), '/login');
  assert.equal(
    withAuthReturn('/login', '/app/calling'),
    `/login?next=${encodeURIComponent(DEFAULT_WORKSPACE_PATH)}`
  );
});

test('feature slugs map to dedicated automation workspaces', () => {
  assert.equal(workspacePathForSlug('whatsapp-calling'), '');
  assert.equal(workspacePathForSlug('whatsapp-broadcasting'), '/app/campaigns');
  assert.equal(workspacePathForSlug('shared-inbox'), '/app/inbox');
  assert.equal(workspacePathForSlug('whatsapp-analytics'), '/app/analytics');
  assert.equal(workspacePathForSlug('whatsapp-ai-agents'), '/app/ai-agents');
  assert.equal(workspacePathForSlug('whatsapp-ads'), '');
  assert.equal(workspacePathForSlug('whatsapp-chatbots'), '/app/bots');
  assert.equal(workspacePathForSlug('broadcasting'), '/app/campaigns');
  assert.equal(workspacePathForSlug('ads-commerce'), '');
});

test('public feature and product hrefs map to workspaces', () => {
  assert.equal(workspacePathForPublicHref('/features/whatsapp-ads'), '');
  assert.equal(workspacePathForPublicHref('/features/whatsapp-calling'), '');
  assert.equal(workspacePathForPublicHref('/products/broadcasting'), '/app/campaigns');
  assert.equal(workspacePathForPublicHref('/features'), '');
  assert.equal(workspacePathForPublicHref('/pricing'), '');
});

test('pricing architecture documents charge layers for published public pricing', () => {
  assert.equal(PRICING_ARCHITECTURE.status, 'published');
  assert.ok(PRICING_ARCHITECTURE.chargeLayers.some((layer) => layer.id === 'platform'));
  assert.ok(PRICING_ARCHITECTURE.chargeLayers.some((layer) => layer.id === 'messaging'));
  assert.ok(PRICING_ARCHITECTURE.draftPlanCodes.includes('enterprise'));
});

test('resolveLaunchCta is auth-aware for feature pages', () => {
  const page = { kind: 'feature', slug: 'whatsapp-calling', title: 'WhatsApp Calling' };
  assert.deepEqual(resolveLaunchCta({ page, authenticated: false }), {
    href: '/signup',
    label: 'Get started free'
  });
  assert.deepEqual(resolveLaunchCta({ page, authenticated: true }), {
    href: DEFAULT_WORKSPACE_PATH,
    label: 'Open workspace'
  });
  const ai = { kind: 'feature', slug: 'whatsapp-ai-agents', title: 'WhatsApp AI Agents' };
  assert.equal(resolveLaunchCta({ page: ai, authenticated: true }).href, '/app/ai-agents');
});
