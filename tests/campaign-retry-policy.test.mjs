import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyCampaignRecipientError,
  isRetryableCampaignJobError,
  recipientErrorRetryable
} from '../lib/campaign-retry-policy.js';

test('isRetryableCampaignJobError accepts rate limits and 5xx', () => {
  assert.equal(isRetryableCampaignJobError({ status: 429 }), true);
  assert.equal(isRetryableCampaignJobError({ status: 503 }), true);
  assert.equal(isRetryableCampaignJobError({ status: 400, message: 'template not approved' }), false);
});

test('classifyCampaignRecipientError blocks consent and template failures', () => {
  assert.equal(classifyCampaignRecipientError('Recipient opted out').retryable, false);
  assert.equal(classifyCampaignRecipientError('rate limit exceeded').retryable, true);
  assert.equal(recipientErrorRetryable('HTTP 429 too many requests'), true);
});
