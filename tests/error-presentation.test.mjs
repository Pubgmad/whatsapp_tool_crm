import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError, toastOptionsFromError } from '../lib/error-presentation.js';

test('session codes map to session recovery messaging', () => {
  const error = Object.assign(new Error('Sign in required'), { code: 'AUTH_REQUIRED', status: 401 });
  const classified = classifyError(error);
  assert.equal(classified.category, 'session');
  assert.equal(classified.kind, 'warning');
  assert.match(classified.body, /Sign in/i);
});

test('does not treat every 403 as a billing problem', () => {
  const error = Object.assign(new Error('Only owners can change this.'), { code: 'FORBIDDEN', status: 403 });
  const classified = classifyError(error);
  assert.equal(classified.category, 'permission');
  assert.notEqual(classified.category, 'plan');
});

test('duplicate phone uses conflict category', () => {
  const error = Object.assign(new Error('Another contact already uses this phone number.'), {
    code: 'DUPLICATE_PHONE',
    status: 409
  });
  const classified = classifyError(error, { operation: 'contacts' });
  assert.equal(classified.category, 'conflict');
  assert.equal(classified.title, 'Already exists');
});

test('meta reconnect codes stay distinct from generic meta failures', () => {
  const reconnect = classifyError(Object.assign(new Error('Token invalid'), { code: 'META_TOKEN_INVALID', status: 401 }));
  assert.equal(reconnect.category, 'meta_reconnect');
  const reconnect2 = classifyError(Object.assign(new Error('Reconnect WhatsApp'), { code: 'META_NOT_CONFIGURED', status: 400 }));
  assert.equal(reconnect2.category, 'meta_reconnect');

  const sendFail = classifyError(Object.assign(new Error('(#131026) Message undeliverable'), {
    code: 'META_SEND_FAILED',
    status: 400
  }));
  assert.equal(sendFail.category, 'meta');
  assert.notEqual(sendFail.category, 'meta_reconnect');
});

test('network failures are retryable section errors', () => {
  const error = Object.assign(new Error('Failed to fetch'), { name: 'TypeError' });
  const classified = classifyError(error, { placement: 'section' });
  assert.equal(classified.category, 'network');
  assert.equal(classified.retryable, true);
});

test('toast options sanitize and title action failures', () => {
  const options = toastOptionsFromError(
    Object.assign(new Error('Campaign could not be saved'), { code: 'SERVER_ERROR', status: 500 }),
    { operation: 'campaign' }
  );
  assert.equal(options.kind, 'error');
  assert.equal(options.title, 'Campaign not saved');
});

test('unknown messages stay honest without fabricated causes', () => {
  const classified = classifyError(new Error('Unexpected upstream response'));
  assert.equal(classified.category, 'unknown');
  assert.equal(classified.body, 'Unexpected upstream response');
});
