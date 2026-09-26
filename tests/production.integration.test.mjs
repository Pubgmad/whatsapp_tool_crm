import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import crypto from 'node:crypto';

test('tenant tables enforce PostgreSQL RLS', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const tables = ['businesses', 'workspace_deletion_requests', 'meta_connection_events', 'meta_authorizations', 'whatsapp_accounts', 'whatsapp_phone_numbers', 'whatsapp_media_assets', 'whatsapp_native_flows', 'whatsapp_analytics_snapshots', 'business_subscriptions', 'billing_events', 'team_invitations', 'contacts', 'templates', 'campaigns', 'automation_flows', 'conversations', 'messages', 'message_usage_events'];
    const result = await client.query('SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)', [tables]);
    assert.equal(result.rows.length, tables.length);
    for (const row of result.rows) assert.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} must force RLS`);
    const indexes = await client.query(
      "SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_whatsapp_accounts_waba_owner','idx_whatsapp_phone_numbers_owner')"
    );
    assert.equal(indexes.rows.length, 2);
  } finally { await client.end(); }
});

test('confirmed usage survives message deletion', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const suffix = crypto.randomBytes(8).toString('hex');
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.system_access','true',true)");
    await client.query('INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3)', [`test_b_${suffix}`, 'Ledger test', `ledger-test-${suffix}`]);
    await client.query('INSERT INTO contacts (id,business_id,name,phone) VALUES ($1,$2,$3,$4)', [`test_c_${suffix}`, `test_b_${suffix}`, 'Test', `9${suffix}`]);
    await client.query('INSERT INTO conversations (id,business_id,contact_id) VALUES ($1,$2,$3)', [`test_v_${suffix}`, `test_b_${suffix}`, `test_c_${suffix}`]);
    await client.query("INSERT INTO messages (id,conversation_id,direction,body,meta_message_id) VALUES ($1,$2,'outgoing',$3,$4)", [`test_m_${suffix}`, `test_v_${suffix}`, 'Test send', `wamid.test.${suffix}`]);
    await client.query('DELETE FROM messages WHERE id=$1', [`test_m_${suffix}`]);
    const usage = await client.query('SELECT COUNT(*)::int AS total FROM message_usage_events WHERE business_id=$1', [`test_b_${suffix}`]);
    assert.equal(usage.rows[0].total, 1);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});

test('deployed application exposes security headers and CSRF endpoint', { skip: !process.env.E2E_BASE_URL }, async () => {
  const base = process.env.E2E_BASE_URL.replace(/\/$/, '');
  const page = await fetch(`${base}/login`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const csrf = await fetch(`${base}/api/security/csrf`);
  const payload = await csrf.json();
  assert.equal(csrf.status, 200);
  assert.ok(payload.csrfToken);
  assert.match(csrf.headers.get('set-cookie') || '', /wcrm_csrf=/);
});

test('workspace deletion review is not accessible without a Super Admin session', { skip: !process.env.E2E_BASE_URL }, async () => {
  const response = await fetch(`${process.env.E2E_BASE_URL.replace(/\/$/, '')}/api/super-admin/workspace-deletion`);
  assert.equal(response.status, 401);
});

test('deleting one workspace cascades only its own tenant records', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  const suffix = crypto.randomBytes(8).toString('hex');
  const first = `test_delete_a_${suffix}`;
  const second = `test_delete_b_${suffix}`;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.system_access','true',true)");
    await client.query(
      'INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3),($4,$5,$6)',
      [first, 'Delete test A', first, second, 'Delete test B', second]
    );
    await client.query(
      'INSERT INTO contacts (id,business_id,name,phone) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
      [`contact_a_${suffix}`, first, 'A', '100000001', `contact_b_${suffix}`, second, 'B', '100000002']
    );
    await client.query('DELETE FROM businesses WHERE id=$1', [first]);
    const remaining = await client.query('SELECT business_id FROM contacts WHERE id=ANY($1)', [[`contact_a_${suffix}`, `contact_b_${suffix}`]]);
    assert.deepEqual(remaining.rows.map((row) => row.business_id), [second]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
