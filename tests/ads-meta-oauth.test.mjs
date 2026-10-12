import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADS_CONFIG_CONNECT_SCOPES,
  ADS_REQUIRED_SCOPES,
  adsConnectRequiredScopes,
  adsLoginConfigId,
  createAdsOAuthState,
  permissionReportFromScopes,
  verifyAdsOAuthState
} from '../lib/ads-meta-oauth.js';
import { whatsappAdTargeting, whatsappAdPayload } from '../lib/whatsapp-ads.js';

test('signed Ads OAuth state round-trips without database', () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'unit-test-auth-secret-for-ads-oauth-state';
  try {
    const state = createAdsOAuthState({ businessId: 'biz_123', userId: 'user_456', ttlSeconds: 300 });
    const parsed = verifyAdsOAuthState(state);
    assert.deepEqual(parsed, { businessId: 'biz_123', userId: 'user_456' });
    assert.equal(verifyAdsOAuthState(state.slice(0, -2) + 'xx'), null);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});

test('permissionReportFromScopes flags missing ads permissions', () => {
  const previous = process.env.META_ADS_LOGIN_CONFIG_ID;
  try {
    delete process.env.META_ADS_LOGIN_CONFIG_ID;
    const incomplete = permissionReportFromScopes(['ads_read', 'pages_show_list']);
    assert.equal(incomplete.complete, false);
    assert.ok(incomplete.missing.includes('ads_management'));
    assert.ok(incomplete.missing.includes('leads_retrieval'));
    assert.equal(incomplete.loginMode, 'scope');
    const complete = permissionReportFromScopes(ADS_REQUIRED_SCOPES);
    assert.equal(complete.complete, true);
    assert.deepEqual(complete.missing, []);
  } finally {
    if (previous === undefined) delete process.env.META_ADS_LOGIN_CONFIG_ID;
    else process.env.META_ADS_LOGIN_CONFIG_ID = previous;
  }
});

test('META_ADS_LOGIN_CONFIG_ID switches connect requirements to CTWA config scopes', () => {
  const previous = process.env.META_ADS_LOGIN_CONFIG_ID;
  try {
    delete process.env.META_ADS_LOGIN_CONFIG_ID;
    assert.equal(adsLoginConfigId(), '');
    assert.deepEqual(adsConnectRequiredScopes(), [...ADS_REQUIRED_SCOPES]);

    process.env.META_ADS_LOGIN_CONFIG_ID = '123456789012345';
    assert.equal(adsLoginConfigId(), '123456789012345');
    assert.deepEqual(adsConnectRequiredScopes(), [...ADS_CONFIG_CONNECT_SCOPES]);
    const report = permissionReportFromScopes(ADS_CONFIG_CONNECT_SCOPES);
    assert.equal(report.complete, true);
    assert.equal(report.loginMode, 'config_id');
    assert.ok(report.missingExtended.includes('leads_retrieval'));
  } finally {
    if (previous === undefined) delete process.env.META_ADS_LOGIN_CONFIG_ID;
    else process.env.META_ADS_LOGIN_CONFIG_ID = previous;
  }
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
