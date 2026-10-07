import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { enterSystemContext, query } from '../lib/db.js';
import { enqueueMetaWebhookChanges, runMetaWebhookQueue } from '../lib/meta-webhook-queue.js';

test('Meta queue rejects malformed webhook envelopes before database access', async () => {
  const resolve = async () => ({ id: 'unused' });
  await assert.rejects(enqueueMetaWebhookChanges({}, resolve), { code: 'META_WEBHOOK_INVALID' });
  await assert.rejects(enqueueMetaWebhookChanges({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: '', value: {} }] }] }, resolve), { code: 'META_WEBHOOK_INVALID' });
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
