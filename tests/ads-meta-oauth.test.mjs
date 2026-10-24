import assert from 'node:assert/strict';
import test from 'node:test';
import { ADS_REQUIRED_SCOPES, createAdsOAuthState, oauthCompletionAllowed, permissionReportFromScopes, verifyAdsOAuthState } from '../lib/ads-meta-oauth.js';
import { parseRequestedCapabilities } from '../lib/ads-capabilities.js';
import { whatsappAdTargeting, whatsappAdPayload } from '../lib/whatsapp-ads.js';

test('signed Ads OAuth state round-trips without database', () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'unit-test-auth-secret-for-ads-oauth-state';
  try {
    const state = createAdsOAuthState({ businessId: 'biz_123', userId: 'user_456', sessionVersion: 4, capabilities: ['ctwa', 'reporting'], redirectUri: 'https://crm.example.test/api/whatsapp/ads/oauth/callback', ttlSeconds: 300 });
    const parsed = verifyAdsOAuthState(state);
    assert.equal(parsed.businessId, 'biz_123');
    assert.equal(parsed.userId, 'user_456');
    assert.equal(parsed.sessionVersion, 4);
    assert.deepEqual(parsed.capabilities, ['ctwa', 'reporting']);
    assert.equal(verifyAdsOAuthState(state.slice(0, -2) + 'xx'), null);
    assert.equal(oauthCompletionAllowed({ user_id: 'user_456', business_id: 'biz_123', session_version: 4 }, { userId: 'user_456', businessId: 'biz_123', sessionVersion: 4 }).ok, true);
    assert.equal(oauthCompletionAllowed({ user_id: 'user_456', business_id: 'biz_123', session_version: 4 }, { userId: 'other', businessId: 'biz_123', sessionVersion: 4 }).code, 'META_OAUTH_SESSION');
    assert.equal(oauthCompletionAllowed({ user_id: 'user_456', business_id: 'biz_123', session_version: 4 }, { userId: 'user_456', businessId: 'other', sessionVersion: 4 }).code, 'META_OAUTH_TENANT');
    assert.equal(
      oauthCompletionAllowed(
        { user_id: 'user_456', business_id: 'biz_123', session_version: 4, login_session_id: 'browser-a' },
        { userId: 'user_456', businessId: 'biz_123', sessionVersion: 4, loginSessionId: 'browser-b' }
      ).ok,
      false
    );
    assert.equal(
      oauthCompletionAllowed(
        { user_id: 'user_456', business_id: 'biz_123', session_version: 4, login_session_id: 'browser-a' },
        { userId: 'user_456', businessId: 'biz_123', sessionVersion: 4, loginSessionId: 'browser-a' }
      ).ok,
      true
    );
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});

test('permissionReportFromScopes separates CTWA from optional leads', () => {
  const incomplete = permissionReportFromScopes(['ads_read', 'pages_show_list']);
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.missing.includes('ads_management'));
  assert.equal(incomplete.capabilities.leads.status, 'not_requested');
  const ctwaOnly = permissionReportFromScopes([
    'ads_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads'
  ], ['ctwa', 'leads']);
  assert.equal(ctwaOnly.complete, true);
  assert.equal(ctwaOnly.capabilities.ctwa.enabled, true);
  assert.equal(ctwaOnly.capabilities.leads.status, 'optional_unavailable');
  assert.ok(ctwaOnly.optionalUnavailable.includes('leads_retrieval'));
  const complete = permissionReportFromScopes(ADS_REQUIRED_SCOPES);
  assert.equal(complete.complete, true);
  assert.equal(complete.capabilities.reporting.enabled, true);
  assert.throws(() => parseRequestedCapabilities('business_assets'), /not available/);
});

test('WhatsApp Status placement adds required Meta targeting keys', () => {
  const targeting = whatsappAdTargeting({
    countries: ['US'],
    ageMin: 18,
    ageMax: 45,
    statusPlacement: true
  });
  assert.deepEqual(targeting.publisher_platforms, ['instagram', 'whatsapp']);
  assert.deepEqual(targeting.instagram_positions, ['story']);
  assert.deepEqual(targeting.whatsapp_positions, ['status']);
});

test('WHATSAPP_STATUS objective builds CTWA destination with status placement', () => {
  const payload = whatsappAdPayload(
    {
      name: 'Status ad',
      text: 'Chat with us',
      headline: 'Hello',
      imageHash: 'a'.repeat(32),
      objectiveKind: 'WHATSAPP_STATUS',
      countries: ['IN'],
      ageMin: 21,
      ageMax: 55,
      budgetType: 'daily',
      dailyBudget: '10.00',
      requestId: 'req_status_placement_01'
    },
    { page_id: '111', currency: 'INR' },
    '919876543210'
  );
  assert.equal(payload.objectiveKind, 'WHATSAPP_STATUS');
  assert.equal(payload.statusPlacement, true);
  assert.deepEqual(payload.adset.targeting.whatsapp_positions, ['status']);
  assert.equal(payload.adset.destination_type, 'WHATSAPP');
});
