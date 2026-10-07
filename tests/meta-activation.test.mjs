import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaActivationChecklist } from '../lib/meta-activation.js';

test('activation checklist flags missing connection and passes onboarded MM API', () => {
  const checklist = buildMetaActivationChecklist({
    accounts: [{
      isDefault: true,
      status: 'connected',
      wabaId: '123',
      webhookSubscribed: true,
      marketingMessagesStatus: 'ONBOARDED',
      token: { status: 'healthy', expiresAt: '2030-01-01T00:00:00.000Z' },
      health: { reason: '', lastWebhookAt: '2026-01-01T00:00:00.000Z' }
    }],
    phoneNumbers: [{ isDefault: true, registrationState: 'registered', displayPhoneNumber: '+15551234567', messagingLimitTier: 'TIER_1K' }],
    capabilities: [
      { key: 'templates', status: 'available' },
      { key: 'native_flows', status: 'setup' },
      { key: 'ctwa', status: 'setup' },
      { key: 'catalogs', status: 'available', detail: '2 catalogs' },
      { key: 'calling', status: 'setup' }
    ]
  });
  assert.equal(checklist.readyForMessaging, true);
  assert.equal(checklist.steps.find((step) => step.id === 'marketing_messages_api').status, 'pass');
  assert.equal(checklist.steps.find((step) => step.id === 'connection').status, 'pass');
});

test('activation checklist blocks when webhook subscription is missing', () => {
  const checklist = buildMetaActivationChecklist({
    accounts: [{ isDefault: true, status: 'connected', webhookSubscribed: false, health: { reason: 'webhook_unsubscribed' }, token: { status: 'healthy' } }],
    phoneNumbers: [{ isDefault: true, registrationState: 'registered' }],
    capabilities: []
  });
  assert.equal(checklist.readyForMessaging, false);
  assert.equal(checklist.steps.find((step) => step.id === 'webhooks').status, 'fail');
});
