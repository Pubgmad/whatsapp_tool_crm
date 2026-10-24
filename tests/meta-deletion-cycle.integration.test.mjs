import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

test('Meta deletion runs again after reconnect collects new data', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const previousSecret = process.env.META_APP_SECRET;
  const secret = crypto.randomBytes(32).toString('hex');
  process.env.META_APP_SECRET = secret;
  process.env.APP_URL = 'https://crm.example.test';
  const { handleMetaDataDeletion } = await import('../lib/meta-data-controls.js');
  const { recordMetaAuthorization } = await import('../lib/meta-authorization.js');
  const { ingestMetaLeadgenSubmission } = await import('../lib/meta-leadgen-ingest.js');
  const suffix = crypto.randomBytes(8).toString('hex');
  const businessId = `test_b_${suffix}`;
  const metaUserId = `test_meta_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: metaUserId })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const request = () => new Request('https://crm.example.test/api/meta/data-deletion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ signed_request: `${signature}.${payload}` })
  });
  let firstCode = '';
  let secondCode = '';
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query(
      'INSERT INTO businesses (id,name,slug,waba_id,phone_number_id,access_token_encrypted,status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [businessId, 'Cycle test', `cycle-${suffix}`, `waba_${suffix}`, `phone_${suffix}`, 'enc', 'Connected']
    );
    await client.query(
      'INSERT INTO meta_authorizations (id,business_id,meta_user_id,integration) VALUES ($1,$2,$3,$4)',
      [`test_ma_${suffix}`, businessId, metaUserId, 'whatsapp']
    );
    firstCode = (await (await handleMetaDataDeletion(request())).json()).confirmation_code;
    await recordMetaAuthorization(client, {
      businessId,
      metaUserId,
      integration: 'ads',
      appSecret: secret,
      assets: { pageId: '123' }
    });
    await ingestMetaLeadgenSubmission(client, businessId, {
      formId: 'form1',
      leadId: `lead_${suffix}`,
      field_data: [{ name: 'email', values: ['lead@example.test'] }],
      metaUserId
    });
    const leadRow = await client.query('SELECT COUNT(*)::int AS total FROM meta_leadgen_submissions WHERE business_id=$1', [businessId]);
    assert.equal(leadRow.rows[0].total, 1);
    secondCode = (await (await handleMetaDataDeletion(request())).json()).confirmation_code;
    assert.notEqual(secondCode, firstCode);
    const leadAfter = await client.query('SELECT COUNT(*)::int AS total FROM meta_leadgen_submissions WHERE business_id=$1', [businessId]);
    assert.equal(leadAfter.rows[0].total, 0);
    const dup = await handleMetaDataDeletion(request());
    assert.equal((await dup.json()).confirmation_code, secondCode);
  } finally {
    await client.query('DELETE FROM meta_data_deletion_requests WHERE meta_user_id_hash=$1', [
      crypto.createHmac('sha256', secret).update(metaUserId).digest('hex')
    ]);
    await client.query('DELETE FROM businesses WHERE id=$1', [businessId]);
    await client.end();
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
  }
});
