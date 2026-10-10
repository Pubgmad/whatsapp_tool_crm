import assert from 'node:assert/strict';
import test from 'node:test';
import { ADS_REQUIRED_SCOPES, permissionReportFromScopes } from '../lib/ads-meta-oauth.js';
import { whatsappAdTargeting, whatsappAdPayload } from '../lib/whatsapp-ads.js';

test('permissionReportFromScopes flags missing ads permissions', () => {
  const incomplete = permissionReportFromScopes(['ads_read', 'pages_show_list']);
  assert.equal(incomplete.complete, false);
  assert.ok(incomplete.missing.includes('ads_management'));
  assert.ok(incomplete.missing.includes('leads_retrieval'));
  const complete = permissionReportFromScopes(ADS_REQUIRED_SCOPES);
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.missing, []);
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
