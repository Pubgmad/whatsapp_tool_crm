const RECIPIENT_RETRY_BLOCK = /(opt.?out|unsubscrib|consent|permission|template|approved|audience|not approved|waba|mismatch|reconnect|opted out|unconfirmed|invalid phone)/i;
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
  if (error?.metaMessageId || error?.deliveryKnown === true) return false;
  if (code === 'META_SEND_FAILED' && status !== 429 && !(status >= 500 && status < 600)) return false;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  if (['RATE_LIMIT', 'META_RATE_LIMIT', 'TEMPORARILY_UNAVAILABLE', '130429', '4'].includes(code)) return true;
  const message = String(error?.message || '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many requests') || message.includes('temporarily unavailable');
}

export function classifyCampaignSendError({
  message = '',
  status = 0,
  code = '',
  metaMessageId = '',
  deliveryKnown = false,
  httpStatus = 0
} = {}) {
  const http = Number(httpStatus || status || 0);
  const errorCode = String(code || '').toUpperCase();
  const text = String(message || '');
  if (metaMessageId || deliveryKnown || errorCode === 'META_SEND_ACCEPTED') {
    return {
      retryable: false,
      category: 'accepted',
      reason: 'Meta accepted the message. Do not resend without checking delivery state.',
      reconciliationRequired: false
    };
  }
  if (errorCode === 'META_SEND_UNCONFIRMED' || /delivery is unconfirmed|verify in meta before/i.test(text)) {
    return {
      retryable: false,
      category: 'uncertain',
      reason: 'Delivery outcome is uncertain. Reconcile in Meta or the inbox before resending.',
      reconciliationRequired: true
    };
  }
  if (!text.trim() && !http && !errorCode) {
    return { retryable: false, category: 'unknown', reason: 'No error recorded', reconciliationRequired: false };
  }
  if (RECIPIENT_RETRY_BLOCK.test(text)) {
    return {
      retryable: false,
      category: 'policy_or_template',
      reason: 'Consent, template, audience, or validation issue',
      reconciliationRequired: false
    };
  }
  const structuredRetry = isRetryableCampaignJobError({ message: text, status: http, code: errorCode });
  if (structuredRetry) {
    return {
      retryable: true,
      category: 'transient',
      reason: 'Transient delivery or rate limit',
      reconciliationRequired: false
    };
  }
  if (RECIPIENT_RETRY_TRANSIENT.test(text)) {
    return {
      retryable: true,
      category: 'transient',
      reason: 'Transient delivery or rate limit',
      reconciliationRequired: false
    };
  }
  if (http === 429 || (http >= 500 && http < 600 && errorCode === 'META_SEND_FAILED')) {
    return {
      retryable: true,
      category: 'transient',
      reason: 'Transient Meta rejection',
      reconciliationRequired: false
    };
  }
  if (http >= 400 && http < 500 && http !== 408 && http !== 409 && http !== 429) {
    return {
      retryable: false,
      category: 'rejected_permanent',
      reason: 'Meta rejected the send until the underlying issue is fixed',
      reconciliationRequired: false
    };
  }
  return {
    retryable: false,
    category: 'unknown',
    reason: 'Check Meta before resending. Unknown errors are not retried automatically.',
    reconciliationRequired: false
  };
}

export function classifyCampaignRecipientError(error = '') {
  if (typeof error === 'object' && error !== null) {
    return classifyCampaignSendError(error);
  }
  return classifyCampaignSendError({ message: String(error || '') });
}

export function recipientErrorRetryable(error) {
  if (typeof error === 'object' && error !== null) {
    return classifyCampaignSendError(error).retryable;
  }
  return classifyCampaignRecipientError(error).retryable;
}

export function campaignRecipientRetryFields(row = {}) {
  return {
    message: row.error_message || '',
    code: row.last_error_code || '',
    httpStatus: Number(row.last_http_status || 0),
    metaMessageId: row.meta_message_id || '',
    deliveryKnown: row.delivery_state === 'accepted'
  };
}
