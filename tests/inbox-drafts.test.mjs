import test from 'node:test';
import assert from 'node:assert/strict';
import { saveConversationDraft, clearSentConversationDraft, canApplySupportSuggestion } from '../lib/inbox-drafts.js';

test('reply drafts stay isolated by conversation', () => {
  const first = saveConversationDraft({}, 'conversation-a', 'Reply for A');
  const second = saveConversationDraft(first, 'conversation-b', 'Reply for B');
  assert.deepEqual(second, { 'conversation-a': 'Reply for A', 'conversation-b': 'Reply for B' });
  assert.deepEqual(first, { 'conversation-a': 'Reply for A' });
});

test('a completed send only clears the exact draft that was sent', () => {
  const drafts = { 'conversation-a': 'Newer edit', 'conversation-b': 'Reply for B' };
  assert.equal(clearSentConversationDraft(drafts, 'conversation-a', 'Older edit'), drafts);
  assert.deepEqual(clearSentConversationDraft(drafts, 'conversation-b', 'Reply for B'), { 'conversation-a': 'Newer edit' });
});

test('a support suggestion is rejected after switching threads, editing, or receiving a new message', () => {
  const request = { requestedConversationId: 'conversation-a', requestedMessageId: 'message-1', requestedRevision: 4 };
  const current = { activeConversationId: 'conversation-a', activeMessageId: 'message-1', activeRevision: 4 };
  assert.equal(canApplySupportSuggestion({ ...request, ...current }), true);
  assert.equal(canApplySupportSuggestion({ ...request, ...current, activeConversationId: 'conversation-b' }), false);
  assert.equal(canApplySupportSuggestion({ ...request, ...current, activeMessageId: 'message-2' }), false);
  assert.equal(canApplySupportSuggestion({ ...request, ...current, activeRevision: 5 }), false);
});
