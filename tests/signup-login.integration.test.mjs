import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

test('signup requires email verification before login', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
  process.env.APP_URL = 'http://localhost:3100';
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;

  const { registerAccount, loginAccount, createSessionToken, currentAccount } = await import('../lib/auth.js');
  const { issueVerification, verifyEmail, requestPasswordReset } = await import('../lib/account-security.js');
  const { getPublicPlatformConfig } = await import('../lib/platform.js');
  const suffix = crypto.randomBytes(8).toString('hex');
  const email = `signup-${suffix}@example.test`;
  const password = `Aa1${crypto.randomBytes(16).toString('base64url')}`;
  const account = await registerAccount({ name: 'Signup test', email, password, businessName: `Signup ${suffix}` });

  await assert.rejects(loginAccount({ email, password }), { code: 'EMAIL_NOT_VERIFIED' });
  const verification = await issueVerification(account.userId);
  assert.equal(verification.sent, false);
  const token = new URL(verification.developmentUrl).searchParams.get('token');
  assert.ok(token);
  await verifyEmail(token);

  const session = await loginAccount({ email, password });
  assert.equal(session.businessId, account.businessId);
  const request = new Request('http://localhost:3100/api/me', {
    headers: { cookie: `wcrm_session=${encodeURIComponent(createSessionToken(session))}` }
  });
  const current = await currentAccount(request);
  assert.equal(current.user.email, email);
  assert.equal(current.business.id, account.businessId);

  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'Security <security@example.test>';
  const originalFetch = globalThis.fetch;
  let delivered;
  try {
    globalThis.fetch = async (_url, options) => {
      delivered = JSON.parse(options.body);
      return new Response('{}', { status: 200 });
    };
    await requestPasswordReset(email);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const platform = await getPublicPlatformConfig();
  assert.match(delivered.subject, new RegExp(platform.brand_name));
  assert.match(delivered.html, /Reset password/);
  assert.match(delivered.text, /http:\/\/localhost:3100\/reset-password\?token=/);

  const { getPool } = await import('../lib/db.js');
  const pool = getPool();
  const admin = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  const role = `wcrm_rls_${suffix}`;
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await admin.query(`GRANT SELECT ON users,memberships,businesses,business_subscriptions,subscription_plans TO "${role}"`);
    await admin.query(`GRANT SELECT,INSERT,UPDATE ON rate_limits TO "${role}"`);
    await admin.query(`SET ROLE "${role}"`);
    await admin.query('BEGIN');
    const hidden = await admin.query('SELECT id FROM businesses WHERE id=$1', [account.businessId]);
    assert.equal(hidden.rowCount, 0);
    await admin.query("SELECT set_config('app.business_id',$1,true),set_config('app.system_access','false',true)", [account.businessId]);
    const visible = await admin.query('SELECT id FROM businesses WHERE id=$1', [account.businessId]);
    assert.equal(visible.rows[0]?.id, account.businessId);
    await admin.query('ROLLBACK');
    await admin.query('RESET ROLE');

    const originalConnect = pool.connect.bind(pool);
    pool.connect = async () => {
      const client = await originalConnect();
      await client.query(`SET ROLE "${role}"`);
      return client;
    };
    const restrictedAccount = await currentAccount(request);
    assert.equal(restrictedAccount.business.id, account.businessId);
  } finally {
    await pool.end();
    await admin.query('ROLLBACK').catch(() => {});
    await admin.query('RESET ROLE').catch(() => {});
    await admin.query(`DROP OWNED BY "${role}"`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => {});
    await admin.end();
  }
});
