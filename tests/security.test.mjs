import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCsrf, createCsrfToken, readJsonBodyLimited, readTextBodyLimited, requestIp, secureCookieAttribute } from '../lib/security.js';
import { assertRegistrationEmailReady, createSessionToken, emailVerificationRequired, verifySessionToken } from '../lib/auth.js';
import { decryptSecret, encryptSecret } from '../lib/meta.js';
import { databaseSslConfig } from '../lib/db.js';

test('accepts a signed same-origin CSRF token', () => {
  process.env.AUTH_SECRET = 'test-auth-secret-with-sufficient-entropy';
  const token = createCsrfToken();
  const request = new Request('https://crm.example/api/contacts', { method: 'POST', headers: { origin: 'https://crm.example', cookie: `wcrm_csrf=${token}`, 'x-csrf-token': token } });
  assert.doesNotThrow(() => assertCsrf(request));
});

test('rejects missing and cross-origin CSRF requests', () => {
  process.env.AUTH_SECRET = 'test-auth-secret-with-sufficient-entropy';
  const token = createCsrfToken();
  const missing = new Request('https://crm.example/api/contacts', { method: 'POST', headers: { origin: 'https://crm.example' } });
  const crossOrigin = new Request('https://crm.example/api/contacts', { method: 'POST', headers: { origin: 'https://evil.example', cookie: `wcrm_csrf=${token}`, 'x-csrf-token': token } });
  assert.throws(() => assertCsrf(missing), { code: 'CSRF_INVALID' });
  assert.throws(() => assertCsrf(crossOrigin), { code: 'INVALID_ORIGIN' });
});

test('production cookies require HTTPS except for explicit local smoke tests', () => {
  const previousUrl = process.env.APP_URL;
  const previousMode = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    process.env.APP_URL = 'https://crm.example';
    assert.equal(secureCookieAttribute(), '; Secure');
    process.env.APP_URL = 'http://127.0.0.1:3100';
    assert.equal(secureCookieAttribute(), '');
    process.env.APP_URL = 'http://crm.example';
    assert.throws(() => secureCookieAttribute(), { code: 'APP_URL_HTTPS_REQUIRED' });
  } finally {
    if (previousUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousUrl;
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});

test('production registration fails closed until email verification is configured', () => {
  const keys = ['NODE_ENV', 'EMAIL_VERIFICATION_REQUIRED', 'RESEND_API_KEY', 'EMAIL_FROM', 'APP_URL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    process.env.APP_URL = 'https://crm.example';
    assert.equal(emailVerificationRequired(), true);
    assert.throws(() => assertRegistrationEmailReady(), { code: 'EMAIL_NOT_CONFIGURED' });
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'noreply@example.test';
    process.env.APP_URL = 'http://crm.example';
    assert.throws(() => assertRegistrationEmailReady(), { code: 'APP_URL_HTTPS_REQUIRED' });
    process.env.APP_URL = 'https://crm.example';
    assert.doesNotThrow(() => assertRegistrationEmailReady());
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test('bounded JSON reader rejects oversized and invalid uploads', async () => {
  const valid = new Request('https://crm.example/api/contacts/import', { method: 'POST', body: JSON.stringify({ csv: 'name,phone' }) });
  assert.deepEqual(await readJsonBodyLimited(valid, 100), { csv: 'name,phone' });
  const tooLarge = new Request('https://crm.example/api/contacts/import', { method: 'POST', body: 'x'.repeat(101) });
  await assert.rejects(() => readJsonBodyLimited(tooLarge, 100), { code: 'UPLOAD_TOO_LARGE' });
  const invalid = new Request('https://crm.example/api/contacts/import', { method: 'POST', body: '{invalid' });
  await assert.rejects(() => readJsonBodyLimited(invalid, 100), { code: 'INVALID_JSON' });
});

test('bounded raw-body reader preserves signed webhook payloads', async () => {
  const raw = '{"entry":[{"id":"123"}]}';
  const request = new Request('https://crm.example/api/webhooks/meta', { method: 'POST', body: raw });
  assert.equal(await readTextBodyLimited(request, 100), raw);
  const oversized = new Request('https://crm.example/api/webhooks/meta', { method: 'POST', body: 'x'.repeat(101) });
  await assert.rejects(() => readTextBodyLimited(oversized, 100), { code: 'UPLOAD_TOO_LARGE' });
});

test('database TLS verifies certificates unless explicitly overridden', () => {
  const previous = [process.env.DATABASE_SSL, process.env.DATABASE_SSL_INSECURE];
  try {
    process.env.DATABASE_SSL = 'true';
    process.env.DATABASE_SSL_INSECURE = 'false';
    assert.equal(databaseSslConfig().rejectUnauthorized, true);
    process.env.DATABASE_SSL_INSECURE = 'true';
    assert.equal(databaseSslConfig().rejectUnauthorized, false);
  } finally {
    if (previous[0] === undefined) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = previous[0];
    if (previous[1] === undefined) delete process.env.DATABASE_SSL_INSECURE;
    else process.env.DATABASE_SSL_INSECURE = previous[1];
  }
});

test('rate-limit IP handling ignores spoofed first forwarded addresses', () => {
  const request = new Request('https://crm.example/api/auth/login', {
    headers: { 'x-forwarded-for': '198.51.100.20, 203.0.113.12' }
  });
  assert.equal(requestIp(request), '203.0.113.12');
  assert.equal(requestIp(new Request('https://crm.example', { headers: { 'x-real-ip': 'not-an-ip' } })), 'unknown');
});

test('accepts sessions signed by the previous secret during rotation', () => {
  process.env.AUTH_SECRET = 'old-session-secret';
  const token = createSessionToken({ userId: 'u_1', businessId: 'b_1', role: 'Owner' });
  process.env.AUTH_SECRET = 'new-session-secret';
  process.env.AUTH_SECRET_PREVIOUS = 'old-session-secret';
  assert.equal(verifySessionToken(token).businessId, 'b_1');
  delete process.env.AUTH_SECRET_PREVIOUS;
});

test('decrypts stored values with the previous encryption key', () => {
  process.env.ENCRYPTION_KEY = 'old-encryption-key';
  const encrypted = encryptSecret('sensitive-value');
  process.env.ENCRYPTION_KEY = 'new-encryption-key';
  process.env.ENCRYPTION_KEY_PREVIOUS = 'old-encryption-key';
  assert.equal(decryptSecret(encrypted), 'sensitive-value');
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
});
