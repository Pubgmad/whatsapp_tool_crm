/* global process */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { enterSystemContext, query } from '../lib/db.js';
import { enqueueMetaWebhookChanges, runMetaWebhookQueue } from '../lib/meta-webhook-queue.js';

test('Meta queue rejects malformed webhook envelopes before database access', async () => {
  const resolve = async () => ({ id: 'unused' });
  await assert.rejects(enqueueMetaWebhookChanges({}, resolve), { code: 'META_WEBHOOK_INVALID' });
  await assert.rejects(enqueueMetaWebhookChanges({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: '', value: {} }] }] }, resolve), { code: 'META_WEBHOOK_INVALID' });
  await assert.rejects(enqueueMetaWebhookChanges({ object: 'user', entry: [] }, resolve), { code: 'META_WEBHOOK_INVALID' });
});

test('Page leadgen webhooks are accepted and resolve via ads Page connection', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const businessId = `meta_lead_b_${crypto.randomBytes(8).toString('hex')}`;
  const pageId = String(Math.floor(1e12 + Math.random() * 9e12));
  const payload = {
    object: 'page',
    entry: [{
      id: pageId,
      changes: [{ field: 'leadgen', value: { leadgen_id: 'lead_1', form_id: 'form_1', page_id: pageId } }]
    }]
  };
  try {
    const accountId = `meta_lead_wa_${crypto.randomBytes(4).toString('hex')}`;
    const phoneRowId = `meta_lead_wp_${crypto.randomBytes(4).toString('hex')}`;
    const phoneNumberId = `pn_${crypto.randomBytes(4).toString('hex')}`;
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1)', [businessId]);
    await query(
      `INSERT INTO whatsapp_accounts (id,business_id,waba_id,access_token_encrypted,status,is_default)
       VALUES ($1,$2,$3,'encrypted-token','connected',TRUE)`,
      [accountId, businessId, `waba_${crypto.randomBytes(4).toString('hex')}`]
    );
    await query(
      `INSERT INTO whatsapp_phone_numbers (id,business_id,whatsapp_account_id,phone_number_id,is_default,registration_state)
       VALUES ($1,$2,$3,$4,TRUE,'registered')`,
      [phoneRowId, businessId, accountId, phoneNumberId]
    );
    await query(
      `INSERT INTO whatsapp_ads_connections (business_id,ad_account_id,page_id,phone_number_id,currency,access_token_encrypted,authorization_status)
       VALUES ($1,'act_1',$2,$3,'USD','',$4)`,
      [businessId, pageId, phoneNumberId, 'active']
    );
    const resolve = async () => ({ id: 'should-not-be-used-for-page' });
    assert.equal(await enqueueMetaWebhookChanges(payload, resolve), 1);
    assert.equal(await enqueueMetaWebhookChanges(payload, resolve), 1);
    const row = (await query('SELECT business_id,waba_id,field FROM meta_webhook_queue WHERE business_id=$1', [businessId])).rows[0];
    assert.equal(row.business_id, businessId);
    assert.equal(row.waba_id, pageId);
    assert.equal(row.field, 'leadgen');
    // Non-leadgen page fields are ignored (not invalid)
    assert.equal(await enqueueMetaWebhookChanges({
      object: 'page',
      entry: [{ id: pageId, changes: [{ field: 'feed', value: { item: 'status' } }] }]
    }, resolve), 0);
  } finally {
    enterSystemContext();
    await query('DELETE FROM meta_webhook_queue WHERE business_id=$1', [businessId]);
    await query('DELETE FROM whatsapp_ads_connections WHERE business_id=$1', [businessId]);
    await query('DELETE FROM whatsapp_phone_numbers WHERE business_id=$1', [businessId]);
    await query('DELETE FROM whatsapp_accounts WHERE business_id=$1', [businessId]);
    await query('DELETE FROM businesses WHERE id=$1', [businessId]);
  }
});

test('Meta events are acknowledged once, retried independently, and retain failed state', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const businessId = `meta_queue_b_${crypto.randomBytes(8).toString('hex')}`;
  const wabaId = crypto.randomBytes(8).toString('hex');
  const payload = { object: 'whatsapp_business_account', entry: [{ id: wabaId, changes: [{ field: 'messages', value: { metadata: { phone_number_id: '123' }, messages: [{ id: 'wamid.test' }] } }] }] };
  try {
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1)', [businessId]);
    const resolve = async () => ({ id: businessId });
    assert.equal(await enqueueMetaWebhookChanges(payload, resolve), 1);
    assert.equal(await enqueueMetaWebhookChanges(payload, resolve), 1);
    assert.equal((await query('SELECT id FROM meta_webhook_queue WHERE business_id=$1', [businessId])).rowCount, 1);
    let seen = 0;
    const first = await runMetaWebhookQueue({ businessId, processChange: async () => { seen++; throw Object.assign(new Error('retry'), { code: 'RETRY_TEST' }); } });
    assert.equal(first.retried, 1);
    assert.equal((await query('SELECT status,error_code FROM meta_webhook_queue WHERE business_id=$1', [businessId])).rows[0].error_code, 'RETRY_TEST');
    await query('UPDATE meta_webhook_queue SET run_at=NOW() WHERE business_id=$1', [businessId]);
    const second = await runMetaWebhookQueue({ businessId, processChange: async (tenant, waba, field, value) => {
      seen++;
      assert.equal(tenant, businessId);
      assert.equal(waba, wabaId);
      assert.equal(field, 'messages');
      assert.equal(value.messages[0].id, 'wamid.test');
    } });
    assert.equal(second.completed, 1);
    assert.equal(seen, 2);
    assert.equal((await query('SELECT status FROM meta_webhook_queue WHERE business_id=$1', [businessId])).rows[0].status, 'completed');
  } finally {
    enterSystemContext();
    await query('DELETE FROM businesses WHERE id=$1', [businessId]);
  }
});
