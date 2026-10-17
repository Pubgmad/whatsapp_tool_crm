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

test('safeAuthReturnPath defaults to root and blocks open redirects', () => {
  assert.equal(safeAuthReturnPath(''), DEFAULT_POST_AUTH_PATH);
  assert.equal(safeAuthReturnPath('/'), '/');
  assert.equal(safeAuthReturnPath('/app/calling'), '/app/calling');
  assert.equal(safeAuthReturnPath('/app/dashboard'), '/app/dashboard');
  assert.equal(safeAuthReturnPath('https://evil.example'), '/');
  assert.equal(safeAuthReturnPath('//evil.example'), '/');
  assert.equal(safeAuthReturnPath('/super-admin'), '/');
  assert.equal(safeAuthReturnPath('/api/auth/login'), '/');
  assert.equal(safeAuthReturnPath('/login'), '/');
  assert.equal(safeAuthReturnPath('/app/unknown-module'), DEFAULT_WORKSPACE_PATH);
});

test('withAuthReturn preserves query params and next destination', () => {
  assert.equal(withAuthReturn('/login', '/app/calling'), '/login?next=%2Fapp%2Fcalling');
  assert.equal(
    withAuthReturn('/api/auth/google/start?mode=signin', '/app/calling'),
    '/api/auth/google/start?mode=signin&next=%2Fapp%2Fcalling'
  );
  assert.equal(withAuthReturn('/login', '/'), '/login');
});

test('feature slugs map to dedicated CRM workspaces', () => {
  assert.equal(workspacePathForSlug('whatsapp-calling'), '/app/calling');
  assert.equal(workspacePathForSlug('whatsapp-broadcasting'), '/app/campaigns');
  assert.equal(workspacePathForSlug('shared-inbox'), '/app/inbox');
  assert.equal(workspacePathForSlug('whatsapp-analytics'), '/app/analytics');
  assert.equal(workspacePathForSlug('whatsapp-ai-agents'), '/app/ai-agents');
  assert.equal(workspacePathForSlug('whatsapp-ads'), '/app/ads');
  assert.equal(workspacePathForSlug('click-to-whatsapp-ads'), '/app/ads');
  assert.equal(workspacePathForSlug('broadcasting'), '/app/campaigns');
  assert.equal(workspacePathForSlug('ads-commerce'), '/app/ads');
});

test('public feature and product hrefs map to workspaces', () => {
  assert.equal(workspacePathForPublicHref('/features/whatsapp-ads'), '/app/ads');
  assert.equal(workspacePathForPublicHref('/features/whatsapp-calling'), '/app/calling');
  assert.equal(workspacePathForPublicHref('/products/broadcasting'), '/app/campaigns');
  assert.equal(workspacePathForPublicHref('/features'), '');
  assert.equal(workspacePathForPublicHref('/pricing'), '');
});

test('pricing architecture stays draft and separates charge layers', () => {
  assert.equal(PRICING_ARCHITECTURE.status, 'draft');
  assert.ok(PRICING_ARCHITECTURE.chargeLayers.some((layer) => layer.id === 'platform'));
  assert.ok(PRICING_ARCHITECTURE.chargeLayers.some((layer) => layer.id === 'messaging'));
  assert.ok(PRICING_ARCHITECTURE.draftPlanCodes.includes('enterprise'));
});

test('resolveLaunchCta is auth-aware for feature pages', () => {
  const page = { kind: 'feature', slug: 'whatsapp-calling', title: 'WhatsApp Calling' };
  assert.deepEqual(resolveLaunchCta({ page, authenticated: false }), {
    href: '/login?next=%2Fapp%2Fcalling',
    label: 'Use WhatsApp Calling'
  });
  assert.deepEqual(resolveLaunchCta({ page, authenticated: true }), {
    href: '/app/calling',
    label: 'Open WhatsApp Calling'
  });
  const ai = { kind: 'feature', slug: 'whatsapp-ai-agents', title: 'WhatsApp AI Agents' };
  assert.equal(resolveLaunchCta({ page: ai, authenticated: true }).href, '/app/ai-agents');
});
