import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { enterSystemContext, query } from '../lib/db.js';

test('templates are unique per WABA, Meta name and language', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  enterSystemContext();
  const suffix = crypto.randomBytes(6).toString('hex');
  const businessId = `template_b_${suffix}`;
  const add = (id, wabaId, language, name = 'order_update', metaName = 'order_update') => query(
    `INSERT INTO templates (id,business_id,waba_id,name,meta_template_name,language,body)
     VALUES ($1,$2,$3,$4,$5,$6,'Order update')`,
    [id, businessId, wabaId, name, metaName, language]
  );
  try {
    await query('INSERT INTO businesses (id,name,slug) VALUES ($1,$1,$1)', [businessId]);
    await add(`t1_${suffix}`, '10001', 'en_US');
    await add(`t2_${suffix}`, '10001', 'hi_IN');
    await add(`t3_${suffix}`, '10002', 'en_US');
    await assert.rejects(add(`t4_${suffix}`, '10001', 'en_US'), { code: '23505' });
    await assert.rejects(add(`t5_${suffix}`, '10001', 'en_US', 'different_local_name'), { code: '23505' });
    const templates = await query('SELECT waba_id,language FROM templates WHERE business_id=$1 ORDER BY waba_id,language', [businessId]);
    assert.deepEqual(templates.rows, [
      { waba_id: '10001', language: 'en_US' },
      { waba_id: '10001', language: 'hi_IN' },
      { waba_id: '10002', language: 'en_US' }
    ]);
  } finally {
    await query('DELETE FROM businesses WHERE id=$1', [businessId]);
  }
});
