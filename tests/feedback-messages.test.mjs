import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyFeedbackMessage, pendingLabelForMessage } from '../lib/feedback-messages.js';

test('success messages stay success without claiming job completion', () => {
  const queued = classifyFeedbackMessage('Campaign queued');
  assert.equal(queued.kind, 'success');
  assert.equal(queued.body, 'Campaign queued');
});

test('awaiting and processing copy map to informational tone', () => {
  assert.equal(classifyFeedbackMessage('Campaign awaiting owner review').kind, 'info');
  assert.equal(classifyFeedbackMessage('Billing will update after its confirmation webhook').kind, 'info');
});

test('failure phrases map to error tone', () => {
  const failed = classifyFeedbackMessage("Campaign couldn't be saved. Try again.");
  assert.equal(failed.kind, 'error');
  assert.equal(failed.title, 'Action failed');
});

test('pending labels stay action-specific', () => {
  assert.equal(pendingLabelForMessage('Plan updated'), 'Saving…');
  assert.equal(pendingLabelForMessage('Agent invited'), 'Sending invite…');
  assert.equal(pendingLabelForMessage(''), 'Working…');
});
