import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

test('disconnect without remote token reports local disconnect and not_required cleanup', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'integration-test-auth-secret-value';
  const suffix = crypto.randomBytes(6).toString('hex');
  const businessId = `test_b_${suffix}`;
  const userId = `test_u_${suffix}`;
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query('INSERT INTO users (id,name,email,password_hash,session_version) VALUES ($1,$2,$3,$4,0)', [
      userId,
      'Owner',
      `owner-${suffix}@example.test`,
      'scrypt:00:00'
    ]);
    await client.query(
      'INSERT INTO businesses (id,name,slug,waba_id,access_token_encrypted,webhook_subscribed,status) VALUES ($1,$2,$3,$4,$5,FALSE,$6)',
      [businessId, 'Disc', `disc-${suffix}`, `waba_${suffix}`, '', 'Connected']
    );
    await client.query('INSERT INTO memberships (id,user_id,business_id,role) VALUES ($1,$2,$3,$4)', [
      `mb_${suffix}`,
      userId,
      businessId,
      'Owner'
    ]);
    const { createSessionToken } = await import('../lib/auth.js');
    const { createCsrfToken } = await import('../lib/security.js');
    const { disconnectMeta } = await import('../lib/meta-onboarding.js');
    const token = createSessionToken({ userId, businessId, role: 'Owner', sessionVersion: 0, loginSessionId: 'browser-test' });
    const csrf = createCsrfToken();
    const response = await disconnectMeta(
      new Request('http://localhost:3000/api/meta/connection/disconnect', {
        method: 'POST',
        headers: {
          cookie: `wcrm_session=${encodeURIComponent(token)}; wcrm_csrf=${encodeURIComponent(csrf)}`,
          origin: 'http://localhost:3000',
          'x-csrf-token': csrf
        }
      })
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.localDisconnected, true);
    assert.equal(body.remoteCleanup, 'not_required');
  } finally {
    await client.query('DELETE FROM users WHERE id=$1', [userId]);
    await client.query('DELETE FROM businesses WHERE id=$1', [businessId]);
    await client.end();
  }
});
