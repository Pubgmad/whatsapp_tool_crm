import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

test('signup requires email verification before login', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.EMAIL_VERIFICATION_REQUIRED = 'true';
  process.env.APP_URL = 'http://localhost:3100';
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;

  const { registerAccount, loginAccount } = await import('../lib/auth.js');
  const { issueVerification, verifyEmail, requestPasswordReset } = await import('../lib/account-security.js');
  const { getPublicPlatformConfig } = await import('../lib/platform.js');
  const suffix = crypto.randomBytes(8).toString('hex');
  const email = `signup-${suffix}@example.test`;
  const password = crypto.randomBytes(24).toString('base64url');
  const account = await registerAccount({ name: 'Signup test', email, password, businessName: `Signup ${suffix}` });

  await assert.rejects(loginAccount({ email, password }), { code: 'EMAIL_NOT_VERIFIED' });
  const verification = await issueVerification(account.userId);
  assert.equal(verification.sent, false);
  const token = new URL(verification.developmentUrl).searchParams.get('token');
  assert.ok(token);
  await verifyEmail(token);

  const session = await loginAccount({ email, password });
  assert.equal(session.businessId, account.businessId);

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
});
