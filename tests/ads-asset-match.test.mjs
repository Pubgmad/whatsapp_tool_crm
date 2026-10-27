import assert from 'node:assert/strict';
import test from 'node:test';
import { adAccountIsActive, phonesMatch, assertPageWhatsAppMatchesCrm } from '../lib/ads-asset-match.js';
import { adsConnectionWantsLeadgen } from '../lib/whatsapp-ads-report.js';

test('phonesMatch accepts country-code vs local digits', () => {
  assert.equal(phonesMatch('918807111304', '918807111304'), true);
  assert.equal(phonesMatch('918807111304', '8807111304'), true);
  assert.equal(phonesMatch('8807111304', '918807111304'), true);
  assert.equal(phonesMatch('+91 88071 11304', '8807111304'), true);
  assert.equal(phonesMatch('918807111304', '919999999999'), false);
});

test('adAccountIsActive accepts string or number 1', () => {
  assert.equal(adAccountIsActive(1), true);
  assert.equal(adAccountIsActive('1'), true);
  assert.equal(adAccountIsActive(2), false);
  assert.equal(adAccountIsActive('2'), false);
});

test('assertPageWhatsAppMatchesCrm passes with string status and local meta digits', () => {
  const result = assertPageWhatsAppMatchesCrm({
    account: { id: 'act_123', account_status: '1', currency: 'INR' },
    page: { id: '999', whatsapp_number: '8807111304' },
    adAccountId: '123',
    pageId: '999',
    crmDisplayPhone: '+91 88071 11304'
  });
  assert.equal(result.number, '918807111304');
  assert.equal(result.currency, 'INR');
});

test('assertPageWhatsAppMatchesCrm accepts CRM number when Graph omits Page.whatsapp_number', () => {
  const result = assertPageWhatsAppMatchesCrm({
    account: { id: 'act_123', account_status: 1, currency: 'INR' },
    page: { id: '999', whatsapp_number: '', has_whatsapp_number: false },
    adAccountId: '123',
    pageId: '999',
    crmDisplayPhone: '918807111304'
  });
  assert.equal(result.number, '918807111304');
  assert.equal(result.currency, 'INR');
});

test('assertPageWhatsAppMatchesCrm accepts CRM number when New Page Experience hides Graph whatsapp fields', () => {
  const result = assertPageWhatsAppMatchesCrm({
    account: { id: 'act_123', account_status: 1, currency: 'INR' },
    page: {
      id: '999',
      whatsapp_number: '',
      has_whatsapp_number: false,
      has_transitioned_to_new_page_experience: true
    },
    adAccountId: '123',
    pageId: '999',
    crmDisplayPhone: '918807111304'
  });
  assert.equal(result.number, '918807111304');
});

test('assertPageWhatsAppMatchesCrm rejects mismatch when Graph returns a different number', () => {
  assert.throws(
    () =>
      assertPageWhatsAppMatchesCrm({
        account: { id: 'act_123', account_status: 1, currency: 'INR' },
        page: { id: '999', whatsapp_number: '919999999999' },
        adAccountId: '123',
        pageId: '999',
        crmDisplayPhone: '918807111304'
      }),
    (error) => error.code === 'ADS_ASSET_MISMATCH' && /mismatch/i.test(error.message)
  );
});

test('adsConnectionWantsLeadgen only when leads were requested or granted', () => {
  assert.equal(adsConnectionWantsLeadgen({ leadgen_subscribed: false }), false);
  assert.equal(
    adsConnectionWantsLeadgen({
      last_permission_report: { capabilities: { leads: { enabled: true } } }
    }),
    true
  );
  assert.equal(adsConnectionWantsLeadgen({ token_scopes: ['ads_management', 'leads_retrieval'] }), true);
  assert.equal(adsConnectionWantsLeadgen({ token_scopes: ['ads_management'] }), false);
});
