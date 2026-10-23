import assert from 'node:assert/strict';
import test from 'node:test';
import { nextGraphPath } from '../lib/ads-capabilities.js';
import { deriveConnectionCapabilities } from '../lib/ads-capabilities.js';
import {
  acceptEmbeddedSignupMessage,
  createSignupAttempt,
  reduceSignupAttempt,
  signupSubmitPayload
} from '../lib/embedded-signup-attempt.js';
import { resolveEmbeddedSignupSelection } from '../lib/embedded-signup-selection.js';
import { buildReadinessChecks, summarizeReadiness } from '../lib/live-meta-readiness.js';
import { emailVerificationBlocksLogin } from '../lib/auth.js';
import { isRetryableCampaignJobError } from '../lib/campaign-retry-policy.js';
import { verifyMetaSignedRequest } from '../lib/meta-data-controls.js';
import crypto from 'node:crypto';

test('graph pagination keeps a cursor for the next page', () => {
  const next = nextGraphPath('me/adaccounts?fields=id,name&limit=50', { next: 'https://graph.facebook.com/next', cursors: { after: 'CURSOR_2' } });
  assert.match(next, /after=CURSOR_2/);
  assert.equal(nextGraphPath('me/adaccounts?limit=50', { cursors: { after: 'CURSOR_2' } }), '');
});

test('stored connections without recorded scopes are not given lead access', () => {
  const report = deriveConnectionCapabilities([], { scopesRecorded: false });
  assert.equal(report.capabilities.ctwa.enabled, true);
  assert.equal(report.capabilities.ctwa.grandfathered, true);
  assert.equal(report.capabilities.leads.enabled, false);
  const recordedEmpty = deriveConnectionCapabilities([], { scopesRecorded: true });
  assert.equal(recordedEmpty.capabilities.ctwa.enabled, false);
});

test('embedded signup accepts either arrival order once', () => {
  let attempt = reduceSignupAttempt(createSignupAttempt('standard'), { type: 'listen' });
  const early = acceptEmbeddedSignupMessage('https://www.facebook.com', {
    type: 'WA_EMBEDDED_SIGNUP',
    event: 'FINISH',
    data: { waba_id: '111', phone_number_id: '222' }
  });
  attempt = reduceSignupAttempt(attempt, { type: 'message', parsed: early, generation: attempt.generation });
  attempt = reduceSignupAttempt(attempt, { type: 'code', code: 'auth-code' });
  const payload = signupSubmitPayload(attempt);
  assert.equal(payload.wabaId, '111');
  assert.equal(payload.phoneNumberId, '222');
  const duplicate = reduceSignupAttempt(attempt, { type: 'message', parsed: early, generation: attempt.generation });
  assert.equal(duplicate.completion.wabaId, '111');
  const second = reduceSignupAttempt(createSignupAttempt('standard'), { type: 'listen' });
  const ignored = reduceSignupAttempt(second, { type: 'message', parsed: early, generation: attempt.generation });
  assert.equal(ignored.completion, null);
  assert.equal(acceptEmbeddedSignupMessage('https://evil.example', { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: {} }).reason, 'origin');
});

test('embedded signup code can arrive before the completion event', () => {
  let attempt = reduceSignupAttempt(createSignupAttempt('coexistence'), { type: 'listen' });
  attempt = reduceSignupAttempt(attempt, { type: 'code', code: 'code-1' });
  assert.equal(signupSubmitPayload(attempt), null);
  const event = acceptEmbeddedSignupMessage('https://business.facebook.com', JSON.stringify({
    type: 'WA_EMBEDDED_SIGNUP',
    event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
    data: { waba_id: '55', phone_number_id: '66' }
  }));
  attempt = reduceSignupAttempt(attempt, { type: 'message', parsed: event, generation: attempt.generation });
  assert.equal(signupSubmitPayload(attempt).mode, 'coexistence');
  const cancelled = reduceSignupAttempt(reduceSignupAttempt(createSignupAttempt('standard'), { type: 'listen' }), {
    type: 'message',
    generation: undefined,
    parsed: acceptEmbeddedSignupMessage('https://www.facebook.com', { type: 'WA_EMBEDDED_SIGNUP', event: 'CANCEL', data: { current_step: 'PHONE' } })
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(signupSubmitPayload({ ...cancelled, code: 'x' }), null);
});

test('signup selection refuses an arbitrary first asset', () => {
  const ambiguous = resolveEmbeddedSignupSelection({
    mode: 'standard',
    wabaId: '',
    phoneNumberId: '',
    sessionEvent: 'FINISH',
    numbers: [{ id: '1' }, { id: '2' }],
    granularTargetIds: ['10', '11']
  });
  assert.equal(ambiguous.error, 'META_WABA_AMBIGUOUS');
  const single = resolveEmbeddedSignupSelection({
    mode: 'standard',
    wabaId: '',
    phoneNumberId: '',
    sessionEvent: '',
    numbers: [{ id: '9', display_phone_number: '+1' }],
    granularTargetIds: ['10']
  });
  assert.equal(single.wabaId, '10');
  assert.equal(single.phone.id, '9');
  const unauthorized = resolveEmbeddedSignupSelection({
    mode: 'standard',
    wabaId: '99',
    phoneNumberId: '9',
    sessionEvent: 'FINISH',
    numbers: [{ id: '9' }],
    granularTargetIds: ['10']
  });
  assert.equal(unauthorized.error, 'META_WABA_UNAUTHORIZED');
  const coexistence = resolveEmbeddedSignupSelection({
    mode: 'coexistence',
    wabaId: '10',
    phoneNumberId: '9',
    sessionEvent: 'FINISH',
    numbers: [{ id: '9' }],
    granularTargetIds: ['10']
  });
  assert.equal(coexistence.error, 'COEXISTENCE_NOT_CONFIRMED');
});

test('readiness summary separates configuration from missing live evidence', () => {
  const app = { ok: true, https: true, url: 'https://crm.example.test', webhookUrl: 'https://crm.example.test/api/webhooks/meta' };
  const unconfigured = buildReadinessChecks({
    production: true,
    app: { ok: false, https: false, url: '', webhookUrl: '' },
    secrets: { appId: false, appSecret: false },
    workerFresh: false
  });
  assert.equal(summarizeReadiness(unconfigured).summary, 'blocked');
  assert.equal(unconfigured.some((check) => String(check.detail).includes('secret-value')), false);
  const configured = buildReadinessChecks({
    production: true,
    app,
    secrets: { appId: true, appSecret: true },
    workerFresh: true,
    account: null
  });
  assert.equal(summarizeReadiness(configured).summary, 'not_verified');
  assert.equal(configured.find((check) => check.id === 'published_flows').status, 'not_applicable');
  const verified = buildReadinessChecks({
    production: true,
    app,
    secrets: { appId: true, appSecret: true },
    workerFresh: true,
    workerObservedAt: '2026-10-01T00:00:00.000Z',
    account: {
      waba_id: '1',
      status: 'connected',
      health_status: 'healthy',
      webhook_subscribed: true,
      access_token_present: true,
      token_expires_at: null,
      registration_state: 'registered',
      phone_number_id: '2',
      display_phone_number: '+10000000000',
      last_webhook_at: '2026-09-01T00:00:00.000Z',
      last_webhook_field: 'messages'
    }
  });
  assert.equal(summarizeReadiness(verified).summary, 'ready');
  assert.equal(verified.find((check) => check.id === 'webhook_observed').status, 'ready');
  const expired = buildReadinessChecks({
    production: true,
    app,
    secrets: { appId: true, appSecret: true },
    workerFresh: true,
    account: {
      waba_id: '1',
      webhook_subscribed: true,
      access_token_present: true,
      token_expires_at: '2000-01-01T00:00:00.000Z',
      registration_state: 'registered',
      phone_number_id: '2',
      last_webhook_at: '2026-09-01T00:00:00.000Z'
    },
    now: new Date('2026-10-23T00:00:00.000Z')
  });
  assert.equal(expired.find((check) => check.id === 'token').status, 'blocked');
  assert.equal(summarizeReadiness(expired).summary, 'blocked');
});

test('email verification still blocks ordinary unverified users', () => {
  assert.equal(emailVerificationBlocksLogin({ verificationRequired: true, verifiedAt: null }), true);
  assert.equal(emailVerificationBlocksLogin({ verificationRequired: true, verifiedAt: '2026-10-23T00:00:00.000Z' }), false);
  assert.equal(emailVerificationBlocksLogin({ verificationRequired: false, userRequiresVerification: true, verifiedAt: null }), true);
  assert.equal(emailVerificationBlocksLogin({ verificationRequired: false, verifiedAt: null }), false);
});

test('uncertain Meta send failures are not retried', () => {
  assert.equal(isRetryableCampaignJobError({ status: 500, code: 'META_SEND_FAILED' }), false);
  assert.equal(isRetryableCampaignJobError({ status: 409, code: 'META_SEND_UNCONFIRMED' }), false);
  assert.equal(isRetryableCampaignJobError({ status: 429, code: 'META_SEND_FAILED' }), true);
  assert.equal(isRetryableCampaignJobError({ status: 503 }), true);
});

test('meta signed requests reject a bad signature', () => {
  const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'u1' })).toString('base64url');
  const signature = crypto.createHmac('sha256', 'secret').update(payload).digest('base64url');
  assert.equal(verifyMetaSignedRequest(`${signature}.${payload}`, 'secret').user_id, 'u1');
  assert.throws(() => verifyMetaSignedRequest(`${signature}.${payload}`, 'other-secret'), /signature/i);
});
