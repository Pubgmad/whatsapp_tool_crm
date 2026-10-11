import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADS_CORE_SCOPES,
  ADS_EXTENDED_SCOPES,
  ADS_REQUIRED_SCOPES,
  adsOAuthRequestScopes,
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

test('permissionReportFromScopes treats extended scopes as optional for connect', () => {
  const incomplete = permissionReportFromScopes(['ads_read', 'pages_show_list']);
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.missingCore.includes('ads_management'));
  assert.ok(incomplete.missing.includes('leads_retrieval'));

  const coreOnly = permissionReportFromScopes(ADS_CORE_SCOPES);
  assert.equal(coreOnly.complete, true);
  assert.equal(coreOnly.fullComplete, false);
  assert.deepEqual(coreOnly.missingExtended, [...ADS_EXTENDED_SCOPES]);

  const complete = permissionReportFromScopes(ADS_REQUIRED_SCOPES);
  assert.equal(complete.complete, true);
  assert.equal(complete.fullComplete, true);
  assert.deepEqual(complete.missing, []);
});

test('adsOAuthRequestScopes defaults to core scopes to avoid Invalid Scopes loop', () => {
  const previous = process.env.META_ADS_OAUTH_SCOPES;
  try {
    delete process.env.META_ADS_OAUTH_SCOPES;
    assert.deepEqual(adsOAuthRequestScopes(), [...ADS_CORE_SCOPES]);
    assert.ok(!adsOAuthRequestScopes().includes('leads_retrieval'));
    process.env.META_ADS_OAUTH_SCOPES = 'ads_read,leads_retrieval';
    assert.deepEqual(adsOAuthRequestScopes(), ['ads_read', 'leads_retrieval']);
  } finally {
    if (previous === undefined) delete process.env.META_ADS_OAUTH_SCOPES;
    else process.env.META_ADS_OAUTH_SCOPES = previous;
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
