import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCsrf, createCsrfToken, secureCookieAttribute } from '../lib/security.js';
import { createSessionToken, verifySessionToken } from '../lib/auth.js';
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
