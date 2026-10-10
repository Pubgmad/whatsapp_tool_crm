import assert from 'node:assert/strict';
import test from 'node:test';
import { destinationsMatch, expectedAdDestinationType } from '../lib/whatsapp-ads.js';
import { normalizeLeadgenFields, resolveLeadgenBusinessId } from '../lib/meta-leadgen-ingest.js';
import { isoDateUtc } from '../lib/ads-insights-sync.js';
import { normalizeAdObjectiveKind, adObjectiveCatalog } from '../lib/whatsapp-ad-objectives.js';

test('expectedAdDestinationType follows objective and payload', () => {
  assert.equal(expectedAdDestinationType({ payload: { objectiveKind: 'MESSAGES' } }), 'WHATSAPP');
  assert.equal(expectedAdDestinationType({ payload: { objectiveKind: 'WEBSITE_TRAFFIC' } }), 'WEBSITE');
  assert.equal(expectedAdDestinationType({ payload: { objectiveKind: 'LEAD_GENERATION' } }), 'ON_AD');
  assert.equal(
    expectedAdDestinationType({ payload: { objectiveKind: 'MESSAGES', adset: { destination_type: 'website' } } }),
    'WEBSITE'
  );
  assert.equal(destinationsMatch('ON_PLATFORM', 'ON_AD'), true);
  assert.equal(destinationsMatch('WHATSAPP', 'WEBSITE'), false);
});

test('leadgen field normalization and page resolution', async () => {
  const fields = normalizeLeadgenFields([
    { name: 'phone_number', values: ['+1 (555) 010-2030'] },
    { name: 'email', values: ['Ada@Example.TEST'] }
  ]);
  assert.match(fields.phone, /5550102030/);
  assert.equal(fields.email, 'ada@example.test');

  const single = await resolveLeadgenBusinessId(
    async () => ({ rows: [{ business_id: 'b1', waba_id: 'w1' }] }),
    'page1',
    'webhook-b'
  );
  assert.equal(single, 'b1');

  await assert.rejects(
    () =>
      resolveLeadgenBusinessId(
        async () => ({
          rows: [
            { business_id: 'b1', waba_id: 'w1' },
            { business_id: 'b2', waba_id: 'w2' }
          ]
        }),
        'page1',
        ''
      ),
    /Multiple workspaces/
  );
});

test('ads objectives catalog and insight date helper', () => {
  assert.equal(normalizeAdObjectiveKind('lead_generation'), 'LEAD_GENERATION');
  assert.equal(normalizeAdObjectiveKind('WHATSAPP_STATUS'), 'WHATSAPP_STATUS');
  const catalog = adObjectiveCatalog();
  assert.ok(catalog.supported.some((item) => item.id === 'MESSAGES'));
  assert.ok(catalog.supported.some((item) => item.id === 'WHATSAPP_STATUS'));
  assert.match(isoDateUtc(0), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(isoDateUtc(7), /^\d{4}-\d{2}-\d{2}$/);
});
