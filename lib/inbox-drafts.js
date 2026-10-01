export function saveConversationDraft(drafts, conversationId, value) {
  if (!conversationId) return drafts;
  return { ...drafts, [conversationId]: value };
}

export function clearSentConversationDraft(drafts, conversationId, sentDraft) {
  if (drafts[conversationId] !== sentDraft) return drafts;
  const next = { ...drafts };
  delete next[conversationId];
  return next;
}

export function canApplySupportSuggestion({ requestedConversationId, activeConversationId, requestedMessageId, activeMessageId, requestedRevision, activeRevision }) {
  return requestedConversationId === activeConversationId && requestedMessageId === activeMessageId && requestedRevision === activeRevision;
}
