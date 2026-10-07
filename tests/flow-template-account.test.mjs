import test from 'node:test';
import assert from 'node:assert/strict';
import { assertFlowTemplateBinding, createFlowTemplate } from '../lib/flow-templates.js';

const flow = {
  id: 'flow_one', business_id: 'business_one', whatsapp_account_id: 'account_one',
  status: 'published', meta_flow_id: '12345', flow_json: { screens: [{ id: 'START' }] },
  validation_errors: []
};

test('Flow template creation uses the Flow WABA without requiring a phone number', async () => {
  const writes = [];
  const account = { id: 'account_one', waba_id: '67890', access_token_encrypted: 'encrypted', status: 'connected' };
  const result = await createFlowTemplate(
    { businessId: 'business_one', role: 'Owner', userId: 'owner_one' },
    { name: 'booking_flow', language: 'en_US', category: 'UTILITY', body: 'Book a slot', flowId: flow.id, flowAction: 'navigate', flowScreen: 'START', flowButtonText: 'Book' },
    {
      query: async (sql) => ({ rows: sql.includes('whatsapp_native_flows') ? [flow] : sql.includes('whatsapp_accounts') ? [account] : [], rowCount: 0 }),
      createWhatsAppTemplate: async ({ setup }) => { assert.equal(setup.waba_id, account.waba_id); assert.equal(setup.phone_number_id, undefined); return { id: 'meta_template_one', name: 'booking_flow', status: 'PENDING' }; },
      transaction: async (callback) => callback({ query: async (sql, params) => { writes.push({ sql, params }); return { rows: [], rowCount: 1 }; } })
    }
  );
  assert.equal(result.status, 'Pending');
  assert.match(writes[0].sql, /waba_id/);
  assert.equal(writes[0].params[2], account.waba_id);
});

test('Flow template binding rejects a different WABA even with the same Flow account ID', () => {
  const template = {
    business_id: flow.business_id, status: 'Approved', category: 'UTILITY',
    meta_template_id: '888', meta_template_name: 'booking_flow', waba_id: 'wrong_waba',
    component_schema: { flowAccountId: flow.whatsapp_account_id, components: [{ type: 'BUTTONS', buttons: [{ type: 'FLOW', flow_id: flow.meta_flow_id, flow_action: 'navigate', navigate_screen: 'START' }] }] }
  };
  const phone = { business_id: flow.business_id, whatsapp_account_id: flow.whatsapp_account_id, status: 'connected', access_token_encrypted: 'encrypted', waba_id: '67890' };
  assert.throws(() => assertFlowTemplateBinding(template, flow, flow.business_id, phone), { code: 'FLOW_TEMPLATE_ACCOUNT_UNVERIFIED' });
});
