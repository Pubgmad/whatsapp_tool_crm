import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyCampaignRecipientError,
  classifyCampaignSendError,
  isRetryableCampaignJobError,
  recipientErrorRetryable
} from '../lib/campaign-retry-policy.js';

test('isRetryableCampaignJobError accepts rate limits and 5xx', () => {
  assert.equal(isRetryableCampaignJobError({ status: 429 }), true);
  assert.equal(isRetryableCampaignJobError({ status: 503 }), true);
  assert.equal(isRetryableCampaignJobError({ status: 400, message: 'template not approved' }), false);
  assert.equal(isRetryableCampaignJobError({ status: 500, code: 'META_SEND_FAILED' }), true);
  assert.equal(isRetryableCampaignJobError({ status: 409, code: 'META_SEND_UNCONFIRMED' }), false);
});

test('classifyCampaignRecipientError blocks consent and template failures', () => {
  assert.equal(classifyCampaignRecipientError('Recipient opted out').retryable, false);
  assert.equal(classifyCampaignRecipientError('rate limit exceeded').retryable, true);
  assert.equal(recipientErrorRetryable('HTTP 429 too many requests'), true);
});

test('unknown and permanent strings are not treated as rate limited', () => {
  assert.equal(classifyCampaignRecipientError('Unexpected permanent failure').retryable, false);
  assert.equal(classifyCampaignRecipientError('Invalid phone number').retryable, false);
  assert.equal(classifyCampaignRecipientError('').retryable, false);
});

test('structured classification respects Meta codes and delivery state', () => {
  assert.equal(classifyCampaignSendError({ code: 'META_SEND_UNCONFIRMED' }).retryable, false);
  assert.equal(classifyCampaignSendError({ code: 'META_SEND_UNCONFIRMED' }).reconciliationRequired, true);
  assert.equal(classifyCampaignSendError({ status: 503, code: 'META_SEND_FAILED' }).retryable, true);
  assert.equal(classifyCampaignSendError({ metaMessageId: 'wamid.1' }).category, 'accepted');
  assert.equal(
    classifyCampaignSendError({ message: 'failed', code: 'META_SEND_FAILED', httpStatus: 400 }).retryable,
    false
  );
});
