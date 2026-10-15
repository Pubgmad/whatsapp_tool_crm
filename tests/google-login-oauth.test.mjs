import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OAUTH_PASSWORD_SENTINEL,
  createGoogleLoginState,
  digestOAuthState,
  googleLoginConfigured,
  googleLoginRedirectUri,
  safeGoogleNextPath,
  verifyGoogleLoginState
} from '../lib/google-login-oauth.js';
import { verifyPassword } from '../lib/auth.js';

test('googleLoginConfigured reflects login client env vars', () => {
  const prevId = process.env.GOOGLE_LOGIN_CLIENT_ID;
  const prevSecret = process.env.GOOGLE_LOGIN_CLIENT_SECRET;
  const prevApp = process.env.APP_URL;
  delete process.env.GOOGLE_LOGIN_CLIENT_ID;
  delete process.env.GOOGLE_LOGIN_CLIENT_SECRET;
  assert.equal(googleLoginConfigured(), false);
  process.env.GOOGLE_LOGIN_CLIENT_ID = 'client-id';
  process.env.GOOGLE_LOGIN_CLIENT_SECRET = 'secret';
  process.env.APP_URL = 'https://app.example.test';
  assert.equal(googleLoginConfigured(), true);
  if (prevId === undefined) delete process.env.GOOGLE_LOGIN_CLIENT_ID;
  else process.env.GOOGLE_LOGIN_CLIENT_ID = prevId;
  if (prevSecret === undefined) delete process.env.GOOGLE_LOGIN_CLIENT_SECRET;
  else process.env.GOOGLE_LOGIN_CLIENT_SECRET = prevSecret;
  if (prevApp === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = prevApp;
});

test('signed Google login state round-trips and binds mode', () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'unit-test-auth-secret-for-google-login-state';
  try {
    const state = createGoogleLoginState({ mode: 'signup', ttlSeconds: 300 });
    const parsed = verifyGoogleLoginState(state);
    assert.equal(parsed.mode, 'signup');
    assert.ok(parsed.nonce);
    assert.equal(digestOAuthState(state), digestOAuthState(state));
    assert.equal(verifyGoogleLoginState(state.slice(0, -2) + 'xx'), null);
    assert.equal(verifyGoogleLoginState(createGoogleLoginState({ mode: 'signin' })).mode, 'signin');
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previous;
  }
});

test('OAuth password sentinel is rejected by verifyPassword', () => {
  assert.equal(verifyPassword('any-password', OAUTH_PASSWORD_SENTINEL), false);
});

test('googleLoginRedirectUri uses APP_URL callback path', () => {
  const prevApp = process.env.APP_URL;
  process.env.APP_URL = 'https://app.example.test';
  try {
    assert.equal(googleLoginRedirectUri(), 'https://app.example.test/api/auth/google/callback');
  } finally {
    if (prevApp === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prevApp;
  }
});

test('safeGoogleNextPath blocks open redirects and admin paths', () => {
  assert.equal(safeGoogleNextPath('/app/inbox'), '/app/inbox');
  assert.equal(safeGoogleNextPath('https://evil.example'), '/app/dashboard');
  assert.equal(safeGoogleNextPath('//evil.example'), '/app/dashboard');
  assert.equal(safeGoogleNextPath('/super-admin'), '/app/dashboard');
  assert.equal(safeGoogleNextPath('/api/auth/login'), '/app/dashboard');
});
