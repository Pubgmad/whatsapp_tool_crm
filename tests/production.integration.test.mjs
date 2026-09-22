import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

test('tenant tables enforce PostgreSQL RLS', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const tables = ['businesses', 'workspace_deletion_requests', 'meta_connection_events', 'meta_authorizations', 'whatsapp_accounts', 'whatsapp_phone_numbers', 'whatsapp_media_assets', 'whatsapp_native_flows', 'whatsapp_analytics_snapshots', 'business_subscriptions', 'billing_events', 'team_invitations', 'contacts', 'templates', 'campaigns', 'automation_flows', 'conversations', 'messages'];
    const result = await client.query('SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1)', [tables]);
    assert.equal(result.rows.length, tables.length);
    for (const row of result.rows) assert.ok(row.relrowsecurity && row.relforcerowsecurity, `${row.relname} must force RLS`);
  } finally { await client.end(); }
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
