import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCsrf, createCsrfToken } from '../lib/security.js';
import { createSessionToken, verifySessionToken } from '../lib/auth.js';
import { decryptSecret, encryptSecret } from '../lib/meta.js';

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
