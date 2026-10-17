import test from 'node:test';
import assert from 'node:assert/strict';
import { callingAccess, callingRelayReady, validateCallingPolicy } from '../lib/whatsapp-calling.js';

test('calling policy validation rejects invalid roles and oversized agent lists', () => {
  assert.deepEqual(validateCallingPolicy({ roles: ['Owner', 'Agent'], agentIds: null }), { roles: ['Owner', 'Agent'], agentIds: null });
  assert.throws(() => validateCallingPolicy({ roles: ['Owner', 'Viewer'], agentIds: null }), { code: 'CALL_POLICY_INVALID' });
  assert.throws(() => validateCallingPolicy({ roles: ['Owner', 'Owner'], agentIds: null }), { code: 'CALL_POLICY_INVALID' });
  assert.throws(() => validateCallingPolicy({ roles: ['Agent'], agentIds: [''] }), { code: 'CALL_POLICY_INVALID' });
});

test('calling access combines platform and tenant policy', () => {
  const allowed = callingAccess({ role: 'Agent', userId: 'u1' }, { roles: ['Owner', 'Manager', 'Agent'] }, { roles: ['Agent'], agentIds: ['u1'] });
  assert.equal(allowed.canCall, true);
  const deniedRole = callingAccess({ role: 'Agent', userId: 'u1' }, { roles: ['Owner'] }, null);
  assert.equal(deniedRole.canCall, false);
  const deniedMember = callingAccess({ role: 'Agent', userId: 'u2' }, { roles: ['Agent'] }, { roles: ['Agent'], agentIds: ['u1'] });
  assert.equal(deniedMember.canCall, false);
});

test('calling relay readiness requires valid TURN URLs and secret', () => {
  const previousUrls = process.env.WHATSAPP_CALL_TURN_URLS;
  const previousSecret = process.env.WHATSAPP_CALL_TURN_SECRET;
  try {
    delete process.env.WHATSAPP_CALL_TURN_URLS;
    delete process.env.WHATSAPP_CALL_TURN_SECRET;
    assert.equal(callingRelayReady(), false);
    process.env.WHATSAPP_CALL_TURN_URLS = 'turns:relay.example.com:5349';
    process.env.WHATSAPP_CALL_TURN_SECRET = 'test-turn-secret';
    assert.equal(callingRelayReady(), true);
    process.env.WHATSAPP_CALL_TURN_URLS = 'http://bad.example';
    assert.equal(callingRelayReady(), false);
  } finally {
    if (previousUrls === undefined) delete process.env.WHATSAPP_CALL_TURN_URLS; else process.env.WHATSAPP_CALL_TURN_URLS = previousUrls;
    if (previousSecret === undefined) delete process.env.WHATSAPP_CALL_TURN_SECRET; else process.env.WHATSAPP_CALL_TURN_SECRET = previousSecret;
  }
});
