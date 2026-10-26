import assert from 'node:assert/strict';
import test from 'node:test';
import { adAccountIsActive, phonesMatch, assertPageWhatsAppMatchesCrm } from '../lib/ads-asset-match.js';

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

test('assertPageWhatsAppMatchesCrm explains empty page whatsapp without hard-coded assets', () => {
  assert.throws(
    () =>
      assertPageWhatsAppMatchesCrm({
        account: { id: 'act_123', account_status: 1, currency: 'INR' },
        page: { id: '999', whatsapp_number: '' },
        adAccountId: '123',
        pageId: '999',
        crmDisplayPhone: '918807111304'
      }),
    (error) =>
      error.code === 'ADS_ASSET_MISMATCH' &&
      /did not return a WhatsApp number/i.test(error.message) &&
      !/Mathstrat|Sandbox|88071/i.test(error.message)
  );
});
