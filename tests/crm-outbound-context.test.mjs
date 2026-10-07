import test from 'node:test';
import assert from 'node:assert/strict';
import { crmLeadDescription, shouldExportContactToCrm, tenantDisplayName } from '../lib/crm-outbound-context.js';

test('tenantDisplayName prefers workspace then WABA verified name', () => {
  assert.equal(tenantDisplayName({ business_name: 'Acme', verified_name: 'Acme WA' }), 'Acme');
  assert.equal(tenantDisplayName({ verified_name: 'Shop Line', display_phone_number: '+919876543210' }), 'Shop Line');
});

test('shouldExportContactToCrm is WhatsApp-channel scoped', () => {
  assert.equal(shouldExportContactToCrm({ phone: '919876543210', source: 'HubSpot' }), false);
  assert.equal(
    shouldExportContactToCrm({ phone: '919876543210', source: 'Meta webhook', opt_in_source: 'Customer initiated' }),
    true
  );
  assert.equal(
    shouldExportContactToCrm({ phone: '919876543210', source: 'Manual', whatsapp_phone_number_id: '123' }),
    true
  );
});

test('crmLeadDescription uses connected line metadata', () => {
  const text = crmLeadDescription({
    verified_name: 'Brand',
    display_phone_number: '+911234567890',
    opt_in_source: 'Customer initiated',
    source: 'Meta webhook'
  });
  assert.match(text, /Brand/);
  assert.match(text, /Customer initiated/);
});
