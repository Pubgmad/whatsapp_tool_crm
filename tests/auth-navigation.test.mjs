import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionFailure, createRequestGate, authFormPasswordError } from '../lib/auth-navigation.js';
import nextConfig from '../next.config.js';

test('session failures remain distinct from infrastructure and access errors', () => {
  for (const code of ['AUTH_REQUIRED','SESSION_REVOKED','SUPER_ADMIN_AUTH_REQUIRED']) assert.equal(isSessionFailure({code}),true);
  for (const code of ['DB_NOT_CONFIGURED','SERVER_ERROR','RATE_LIMITED','ACCOUNT_SUSPENDED','EMAIL_NOT_VERIFIED','SUPER_ADMIN_FORBIDDEN']) assert.equal(isSessionFailure({code}),false);
  assert.equal(isSessionFailure(new Error('Connection closed')),false);
});
test('stale responses cannot replace the current navigation or revoke its session', () => {
  const gate=createRequestGate(),first=gate.begin(),second=gate.begin();
  assert.equal(gate.current(first),false);assert.equal(gate.current(second),true);
  gate.invalidate();assert.equal(gate.current(second),false);
});
test('existing account passwords are checked by the server, not the signup policy', () => {
  assert.equal(authFormPasswordError('older-pass', 'signin'), '');
  assert.match(authFormPasswordError('older-pass', 'signup'), /12 characters/);
  assert.match(authFormPasswordError('a-longer-password', 'signup'), /uppercase|number/i);
  assert.equal(authFormPasswordError('ValidPass123x', 'signup'), '');
});
test('legacy admin routes resolve one way without changing workspace login',async()=>{
  const routes=await nextConfig.redirects();
  assert.equal(routes.find(route=>route.source==='/admin/dashboard').destination,'/super-admin');
  assert.equal(routes.some(route=>route.source==='/login'||route.destination==='/admin/dashboard'),false);
});
