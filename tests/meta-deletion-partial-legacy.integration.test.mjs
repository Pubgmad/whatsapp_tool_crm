import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

test('Meta deletion marks partial_legacy when legacy lead provenance is ambiguous', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const previousSecret = process.env.META_APP_SECRET;
  const previousAppUrl = process.env.APP_URL;
  const secret = crypto.randomBytes(32).toString('hex');
  process.env.META_APP_SECRET = secret;
  process.env.APP_URL = 'https://crm.example.test';
  const suffix = crypto.randomBytes(8).toString('hex');
  const businessId = `test_b_${suffix}`;
  const metaDeleter = `meta_del_${suffix}`;
  const metaAdsA = `meta_ads_a_${suffix}`;
  const metaAdsB = `meta_ads_b_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  let confirmationCode = '';
  let requestId = '';
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query(
      "INSERT INTO businesses (id,name,slug,waba_id,phone_number_id,access_token_encrypted,status) VALUES ($1,$2,$3,$4,$5,$6,'Connected')",
      [businessId, 'Legacy ambiguity', `legacy-${suffix}`, `waba_${suffix}`, `phone_${suffix}`, 'encrypted-test-value']
    );
    await client.query(
      `INSERT INTO meta_authorizations (id,business_id,meta_user_id,integration,status,is_current)
       VALUES ($1,$2,$3,'whatsapp','active',TRUE)`,
      [`ma_wa_${suffix}`, businessId, metaDeleter]
    );
    await client.query(
      `INSERT INTO meta_authorizations (id,business_id,meta_user_id,integration,status,is_current)
       VALUES ($1,$2,$3,'ads','active',TRUE),($4,$2,$5,'ads','active',TRUE)`,
      [`ma_ads_a_${suffix}`, businessId, metaAdsA, `ma_ads_b_${suffix}`, metaAdsB]
    );
    await client.query(
      `INSERT INTO meta_leadgen_submissions (id,business_id,form_id,lead_id,meta_user_id,field_data)
       VALUES ($1,$2,'form_legacy',$3,'','[]'::jsonb)`,
      [`mlg_legacy_${suffix}`, businessId, `lead_legacy_${suffix}`]
    );
    await client.query(
      "INSERT INTO whatsapp_accounts (id,business_id,waba_id,access_token_encrypted) VALUES ($1,$2,$3,$4)",
      [`wa_${suffix}`, businessId, `waba_${suffix}`, 'encrypted-test-value']
    );
    const { handleMetaDataDeletion } = await import('../lib/meta-data-controls.js');
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: metaDeleter })).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    const response = await handleMetaDataDeletion(
      new Request('https://crm.example.test/api/meta/data-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ signed_request: `${signature}.${payload}` })
      })
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    confirmationCode = body.confirmation_code;
    const record = await client.query(
      'SELECT id, status, result_code, work_log FROM meta_data_deletion_requests WHERE confirmation_code=$1',
      [confirmationCode]
    );
    requestId = record.rows[0].id;
    assert.equal(record.rows[0].status, 'completed');
    assert.equal(record.rows[0].result_code, 'partial_legacy');
    assert.ok(
      (record.rows[0].work_log || []).some((entry) => entry?.note === 'legacy_provenance_unresolved'),
      'expected legacy_provenance_unresolved in work_log'
    );
    const legacyRows = await client.query(
      "SELECT COUNT(*)::int AS total FROM meta_leadgen_submissions WHERE business_id=$1 AND meta_user_id=''",
      [businessId]
    );
    assert.equal(legacyRows.rows[0].total, 1, 'ambiguous legacy submission must remain');
    const { getDeletionStatus } = await import('../lib/meta-data-controls.js');
    const status = await getDeletionStatus(confirmationCode);
    assert.equal(status.result_code, 'partial_legacy');
    assert.notEqual(
      status.result_code,
      'deleted',
      'public status must not report a full deleted outcome'
    );
  } finally {
    if (requestId) await client.query('DELETE FROM meta_data_deletion_requests WHERE id=$1', [requestId]);
    await client.query('DELETE FROM businesses WHERE id=$1', [businessId]);
    await client.end();
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test('operator review can close a partial_legacy deletion with manual evidence', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const suffix = crypto.randomBytes(8).toString('hex');
  const requestId = `mdr_review_${suffix}`;
  const confirmationCode = `mdl_${'b'.repeat(32)}`;
  const adminId = `sa_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const note = 'Verified remaining legacy lead copies were purged manually after ambiguous provenance.';
  const checkedStores = ['meta_leadgen_submissions'];
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query(
      `INSERT INTO super_admins (id,email,password_hash) VALUES ($1,$2,$3)`,
      [adminId, `sa-${suffix}@example.test`, 'hash-placeholder']
    );
    const workLog = [{ store: 'meta_leadgen_legacy', note: 'legacy_provenance_unresolved' }];
    await client.query(
      `INSERT INTO meta_data_deletion_requests
        (id,confirmation_code,meta_user_id_hash,status,result_code,businesses_affected,business_ids,work_log,completed_at)
       VALUES ($1,$2,$3,'completed','partial_legacy',1,'[]'::jsonb,$4::jsonb,NOW())`,
      [requestId, confirmationCode, crypto.createHash('sha256').update(suffix).digest('hex'), JSON.stringify(workLog)]
    );
    const evidence = [
      ...workLog,
      { store: 'manual_review', count: checkedStores.length, note: checkedStores.join(','), at: new Date().toISOString(), reviewer: adminId }
    ];
    const updated = await client.query(
      `UPDATE meta_data_deletion_requests
          SET status='completed', reviewed_by=$2, review_note=$3, work_log=$4::jsonb,
              result_code=CASE WHEN result_code='partial_legacy' THEN 'deleted' ELSE result_code END,
              completed_at=COALESCE(completed_at, NOW()), updated_at=NOW()
        WHERE id=$1
          AND (
            status <> 'completed'
            OR (status = 'completed' AND result_code = 'partial_legacy')
          )
        RETURNING status, result_code, work_log`,
      [requestId, adminId, note, JSON.stringify(evidence)]
    );
    assert.equal(updated.rowCount, 1);
    assert.equal(updated.rows[0].status, 'completed');
    assert.equal(updated.rows[0].result_code, 'deleted');
    assert.ok((updated.rows[0].work_log || []).some((entry) => entry?.store === 'manual_review'));
  } finally {
    await client.query('DELETE FROM meta_data_deletion_requests WHERE id=$1', [requestId]);
    await client.query('DELETE FROM super_admins WHERE id=$1', [adminId]);
    await client.end();
  }
});
