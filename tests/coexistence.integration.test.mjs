import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { enterSystemContext, query } from '../lib/db.js';
import { ingestCoexistenceWebhook } from '../lib/coexistence.js';

test('coexistence imports are tenant-scoped, consent-safe and unbilled', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  enterSystemContext();
  const suffix = crypto.randomBytes(8).toString('hex');
  const businessId = `coex_b_${suffix}`;
  const phoneId = `coex_p_${suffix}`;
  const phoneNumberId = `100${suffix}`;
  try {
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3)', [businessId, 'Coexistence test', businessId]);
    await query("INSERT INTO whatsapp_accounts (id,business_id,waba_id,onboarding_method) VALUES ($1,$2,$3,'coexistence')", [`coex_w_${suffix}`, businessId, `200${suffix}`]);
    await query("INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id,onboarding_method) VALUES ($1,$2,$3,$4,'coexistence')",
      [phoneId, businessId, `coex_w_${suffix}`, phoneNumberId]);
    await query('INSERT INTO whatsapp_coexistence_sync (phone_id,business_id) VALUES ($1,$2)', [phoneId, businessId]);
    const echo = { message_echoes: [{ id: `echo_${suffix}`, from: '919888888888', to: '919876543210', timestamp: '1700000100', type: 'text', text: { body: 'Business App reply' } }] };
    await ingestCoexistenceWebhook(businessId, phoneNumberId, 'smb_message_echoes', echo);
    await ingestCoexistenceWebhook(businessId, phoneNumberId, 'smb_message_echoes', echo);
    const state = { state_sync: [{ type: 'contact', action: 'add', contact: { full_name: 'Asha', phone_number: '919876543210' } }] };
    await ingestCoexistenceWebhook(businessId, phoneNumberId, 'smb_app_state_sync', state);
    await ingestCoexistenceWebhook(businessId, phoneNumberId, 'smb_app_state_sync', state);
    const history = { metadata: { display_phone_number: '919888888888' }, history: [{ threads: [{ id: '919876543210', messages: [
      { id: `hist_${suffix}`, from: '919888888888', timestamp: '1700000000', type: 'text', text: { body: 'Earlier reply' } }
    ] }] }] };
    await ingestCoexistenceWebhook(businessId, phoneNumberId, 'history', history);
    await ingestCoexistenceWebhook(businessId, phoneNumberId, 'history', history);
    const contact = (await query('SELECT marketing_permission,last_message_at,source FROM contacts WHERE business_id=$1', [businessId])).rows[0];
    assert.equal(contact.marketing_permission, false);
    assert.equal(contact.last_message_at, null);
    assert.equal(contact.source, 'WhatsApp Business App');
    assert.equal((await query('SELECT name FROM contacts WHERE business_id=$1', [businessId])).rows[0].name, 'Asha');
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM messages WHERE meta_message_id=$1', [`echo_${suffix}`])).rows[0].count, 1);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM message_usage_events WHERE business_id=$1', [businessId])).rows[0].count, 0);
    const sync = (await query('SELECT contacts_imported,messages_imported,echoes_imported FROM whatsapp_coexistence_sync WHERE phone_id=$1', [phoneId])).rows[0];
    assert.deepEqual([sync.contacts_imported, sync.messages_imported, sync.echoes_imported], [0, 1, 1]);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM messages WHERE meta_message_id=$1', [`hist_${suffix}`])).rows[0].count, 1);
  } finally {
    await query('DELETE FROM businesses WHERE id=$1', [businessId]);
  }
});
