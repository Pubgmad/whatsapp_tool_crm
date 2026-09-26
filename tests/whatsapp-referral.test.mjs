import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWhatsAppReferral } from '../lib/whatsapp-referral.js';

test('keeps only bounded Click-to-WhatsApp referral fields', () => {
  const referral = normalizeWhatsAppReferral({
    source_type: 'ad',
    source_id: '123456789',
    source_url: 'https://www.facebook.com/ads/example',
    headline: 'New collection',
    body: 'Ask us about sizing',
    image_url: 'https://example.test/private-image',
    unexpected: 'discarded'
  });
  assert.deepEqual(referral, {
    sourceType: 'AD',
    sourceId: '123456789',
    headline: 'New collection',
    body: 'Ask us about sizing',
    sourceUrl: 'https://www.facebook.com/ads/example'
  });
});

test('rejects invalid referral identity and unsafe URLs', () => {
  assert.equal(normalizeWhatsAppReferral({ source_type: 'AD', source_id: 'x' }), null);
  assert.equal(normalizeWhatsAppReferral({ source_type: 'UNKNOWN', source_id: '123' }), null);
  const referral = normalizeWhatsAppReferral({
    source_type: 'POST',
    source_id: '456',
    source_url: 'javascript:alert(1)',
    headline: 'X'.repeat(300)
  });
  assert.equal(referral.sourceUrl, undefined);
  assert.equal(referral.headline.length, 200);
});
