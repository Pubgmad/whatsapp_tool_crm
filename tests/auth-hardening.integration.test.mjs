import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

test('concurrent login attempts are counted atomically for an account', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.LOGIN_RATE_LIMIT = '4';
  const { enforceRequestRateLimit } = await import('../lib/security.js');
  const { getPool } = await import('../lib/db.js');
  const suffix = crypto.randomBytes(8).toString('hex');
  const path = `/api/auth/login-${suffix}`;
  const identity = `test-${suffix}@example.test`;
  const ip = '203.0.113.42';
  const request = new Request(`https://example.test${path}`, { headers: { 'x-real-ip': ip } });
  const keys = [`login:identity:${identity}:${path}`, `login:ip:${ip}:${path}`]
    .map((value) => crypto.createHash('sha256').update(value).digest('hex'));
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) => enforceRequestRateLimit(request, index % 2 ? ` ${identity.toUpperCase()} ` : identity, 'login'))
    );
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 4);
    assert.equal(results.filter((result) => result.status === 'rejected' && result.reason?.code === 'RATE_LIMITED').length, 8);
  } finally {
    await getPool().query('DELETE FROM rate_limits WHERE bucket_key=ANY($1)', [keys]);
  }
});

test('password-reset session version revokes earlier cookies', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
  const { createSessionToken, authenticateSessionToken } = await import('../lib/auth.js');
  const { resetPassword } = await import('../lib/account-security.js');
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  const suffix = crypto.randomBytes(8).toString('hex');
  const businessId = `test_b_${suffix}`;
  const userId = `test_u_${suffix}`;
  await client.connect();
  try {
    await client.query("SELECT set_config('app.system_access','true',false)");
    await client.query('INSERT INTO users (id,name,email,password_hash) VALUES ($1,$2,$3,$4)', [userId, 'Test', `test-${suffix}@example.test`, 'unused']);
    await client.query('INSERT INTO businesses (id,name,slug) VALUES ($1,$2,$3)', [businessId, 'Session test', `session-test-${suffix}`]);
    await client.query("INSERT INTO memberships (id,user_id,business_id,role) VALUES ($1,$2,$3,'Owner')", [`test_m_${suffix}`, userId, businessId]);
    const resetToken = crypto.randomBytes(32).toString('base64url');
    await client.query(
      "INSERT INTO auth_tokens (id,user_id,token_type,token_hash,expires_at) VALUES ($1,$2,'password_reset',$3,NOW()+INTERVAL '1 hour')",
      [`test_at_${suffix}`, userId, crypto.createHash('sha256').update(resetToken).digest('hex')]
    );
    const token = createSessionToken({ userId, businessId, role: 'Owner', sessionVersion: 0 });
    assert.equal((await authenticateSessionToken(token)).userId, userId);
    await resetPassword(resetToken, 'new-secure-password-value');
    await assert.rejects(() => authenticateSessionToken(token), { code: 'SESSION_REVOKED' });
  } finally {
    await client.query('DELETE FROM businesses WHERE id=$1', [businessId]);
    await client.query('DELETE FROM users WHERE id=$1', [userId]);
    await client.end();
  }
});
