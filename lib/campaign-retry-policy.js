const RECIPIENT_RETRY_BLOCK = /(opt.?out|unsubscrib|consent|permission|template|approved|audience|not approved|waba|mismatch|reconnect|opted out|unconfirmed)/i;
const RECIPIENT_RETRY_TRANSIENT = /(rate limit|too many requests|429|timeout|temporarily|unavailable|network|503|502|504)/i;

export const CAMPAIGN_RETRY_POLICY = Object.freeze({
  jobMaxAttemptsDefault: 3,
  jobBackoffMinutes: [5, 10, 15, 20, 30],
  recipientManualRetry: {
    description: 'Owner or manager may re-queue failed recipients when the error was transient and the template is still approved.',
    blockedWhenMessageMatches: RECIPIENT_RETRY_BLOCK.source,
    allowedWhenMessageMatches: RECIPIENT_RETRY_TRANSIENT.source
  },
  automaticJobRetry: {
    description: 'Workers retry jobs on HTTP 429, 5xx, and known transient Meta rate-limit signals until max attempts.',
    httpStatuses: [429],
    httpStatusRanges: ['500-599']
  }
});

export function isRetryableCampaignJobError(error) {
  const status = Number(error?.status || 0);
  const code = String(error?.code || '').toUpperCase();
  if (code === 'META_SEND_UNCONFIRMED') return false;
  if (code === 'META_SEND_FAILED' && status !== 429) return false;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  if (['RATE_LIMIT', 'META_RATE_LIMIT', 'TEMPORARILY_UNAVAILABLE', '130429', '4'].includes(code)) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many requests') || message.includes('temporarily unavailable');
}

export function classifyCampaignRecipientError(errorMessage = '') {
  const message = String(errorMessage || '');
  if (!message.trim()) return { retryable: false, category: 'unknown', reason: 'No error recorded' };
  if (RECIPIENT_RETRY_BLOCK.test(message)) {
    return { retryable: false, category: 'policy_or_template', reason: 'Consent, template, or audience issue' };
  }
  if (RECIPIENT_RETRY_TRANSIENT.test(message) || isRetryableCampaignJobError({ message, status: 429 })) {
    return { retryable: true, category: 'transient', reason: 'Transient delivery or rate limit' };
  }
  return { retryable: false, category: 'unknown', reason: 'Check Meta before resending. Uncertain delivery is not retried automatically.' };
}

export function recipientErrorRetryable(errorMessage) {
  return classifyCampaignRecipientError(errorMessage).retryable;
}
