/**
 * Presentation-only error classification.
 * Uses existing client Error.code / Error.status / message — does not invent causes.
 */

const SESSION_CODES = new Set([
  'AUTH_REQUIRED',
  'SESSION_REVOKED',
  'SUPER_ADMIN_AUTH_REQUIRED',
  'SUPER_ADMIN_SESSION_REVOKED',
  'EMAIL_NOT_VERIFIED'
]);

const PERMISSION_CODES = new Set([
  'FORBIDDEN',
  'META_CONNECTION_FORBIDDEN',
  'INVALID_ORIGIN'
]);

const META_RECONNECT_CODES = new Set([
  'META_TOKEN_INVALID',
  'META_SCOPE_MISSING',
  'META_NOT_CONFIGURED',
  'META_PHONE_NOT_CONFIGURED',
  'META_APP_NOT_CONFIGURED',
  'META_EMBEDDED_SIGNUP_NOT_CONFIGURED'
]);

const VALIDATION_CODES = new Set([
  'VALIDATION_ERROR',
  'INVALID_DATE_RANGE',
  'INVALID_VERIFICATION_CODE',
  'INVALID_PIN',
  'INVALID_FLOW_JSON',
  'INVALID_FLOW_RESPONSES',
  'INVALID_ONBOARDING_MODE',
  'META_CODE_REQUIRED',
  'META_CREDENTIALS_REQUIRED',
  'META_USER_MISSING'
]);

const CONFLICT_CODES = new Set([
  'DUPLICATE_PHONE',
  'FLOW_EXISTS',
  'CALL_ALREADY_ACTIVE',
  'CHECKOUT_ALREADY_EXISTS'
]);

const RATE_CODES = new Set(['RATE_LIMITED', 'TOO_MANY_REQUESTS']);

const PLAN_CODES = new Set([
  'PLAN_LIMIT',
  'FEATURE_DISABLED',
  'UPGRADE_REQUIRED',
  'LIMIT_EXCEEDED'
]);

function sanitizeCustomerMessage(message = '') {
  return String(message || '')
    .replace(/https?:\/\/[^\s]*access_token=[^\s]*/gi, '[redacted]')
    .replace(/\baccess_token=[^\s&]+/gi, 'access_token=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280);
}

function looksLikeNetworkFailure(error) {
  if (!error) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('network request failed')
    || message.includes('load failed')
    || error.code === 'NETWORK_ERROR'
  );
}

/**
 * @param {Error|string|null} error
 * @param {{ operation?: string, placement?: string }} [context]
 */
export function classifyError(error, context = {}) {
  const rawMessage = typeof error === 'string' ? error : error?.message;
  const code = typeof error === 'object' && error ? error.code : undefined;
  const status = typeof error === 'object' && error ? Number(error.status) || undefined : undefined;
  const safeBody = sanitizeCustomerMessage(rawMessage) || 'Something went wrong. Try again.';
  const operation = context.operation || '';
  const diagnostics = {
    category: 'unknown',
    code: code || null,
    status: status || null,
    operation: operation || null,
    at: new Date().toISOString()
  };

  if (looksLikeNetworkFailure(error)) {
    return {
      category: 'network',
      kind: 'error',
      title: 'Connection problem',
      body: 'Check your internet connection and try again.',
      placement: context.placement || 'section',
      retryable: true,
      diagnostics: { ...diagnostics, category: 'network' }
    };
  }

  if (SESSION_CODES.has(code)) {
    return {
      category: 'session',
      kind: 'warning',
      title: 'Session expired',
      body: 'Sign in again to continue.',
      placement: 'banner',
      retryable: false,
      diagnostics: { ...diagnostics, category: 'session' }
    };
  }

  if (META_RECONNECT_CODES.has(code)) {
    return {
      category: 'meta_reconnect',
      kind: 'warning',
      title: 'Connection needed',
      body: safeBody || 'Reconnect your Meta account to continue.',
      placement: context.placement || 'banner',
      retryable: false,
      actionHint: 'reconnect',
      diagnostics: { ...diagnostics, category: 'meta_reconnect' }
    };
  }

  if (PERMISSION_CODES.has(code) || (status === 403 && !PLAN_CODES.has(code))) {
    // Do not treat every 403 as billing — only known plan codes do that.
    return {
      category: 'permission',
      kind: 'error',
      title: 'Access restricted',
      body: safeBody.includes('permission') || safeBody.includes('Owners') || safeBody.includes('managers')
        ? safeBody
        : "You don't have permission to perform this action.",
      placement: context.placement || 'toast',
      retryable: false,
      diagnostics: { ...diagnostics, category: 'permission' }
    };
  }

  if (PLAN_CODES.has(code)) {
    return {
      category: 'plan',
      kind: 'warning',
      title: 'Plan limit',
      body: safeBody,
      placement: context.placement || 'section',
      retryable: false,
      diagnostics: { ...diagnostics, category: 'plan' }
    };
  }

  if (status === 401) {
    return {
      category: 'session',
      kind: 'warning',
      title: 'Session expired',
      body: 'Sign in again to continue.',
      placement: 'banner',
      retryable: false,
      diagnostics: { ...diagnostics, category: 'session' }
    };
  }

  // Known Meta send / request failures — use server message, don't invent token expiry.
  if (code && String(code).startsWith('META_')) {
    return {
      category: 'meta',
      kind: 'error',
      title: operationTitle(operation) || 'WhatsApp request failed',
      body: safeBody,
      placement: context.placement || 'toast',
      retryable: true,
      diagnostics: { ...diagnostics, category: 'meta' }
    };
  }

  if (VALIDATION_CODES.has(code) || (status === 400 && !code)) {
    return {
      category: 'validation',
      kind: 'error',
      title: 'Check your input',
      body: safeBody,
      placement: context.placement || 'inline',
      retryable: false,
      diagnostics: { ...diagnostics, category: 'validation' }
    };
  }

  if (CONFLICT_CODES.has(code) || status === 409) {
    return {
      category: 'conflict',
      kind: 'error',
      title: 'Already exists',
      body: safeBody,
      placement: context.placement || 'inline',
      retryable: false,
      diagnostics: { ...diagnostics, category: 'conflict' }
    };
  }

  if (RATE_CODES.has(code) || status === 429) {
    return {
      category: 'rate_limit',
      kind: 'warning',
      title: 'Too many requests',
      body: 'Wait a moment, then try again.',
      placement: context.placement || 'toast',
      retryable: true,
      diagnostics: { ...diagnostics, category: 'rate_limit' }
    };
  }

  if (status === 408 || code === 'TIMEOUT' || /timeout/i.test(safeBody)) {
    return {
      category: 'timeout',
      kind: 'error',
      title: 'Request timed out',
      body: 'The request took too long. Try again.',
      placement: context.placement || 'section',
      retryable: true,
      diagnostics: { ...diagnostics, category: 'timeout' }
    };
  }

  if (status >= 500 || code === 'SERVER_ERROR' || code === 'DB_PERMISSION_DENIED' || code === 'DB_NOT_CONFIGURED') {
    return {
      category: 'server',
      kind: 'error',
      title: operationTitle(operation) || 'Temporarily unavailable',
      body: safeBody || "This couldn't be completed right now. Try again shortly.",
      placement: context.placement || 'section',
      retryable: true,
      diagnostics: { ...diagnostics, category: 'server' }
    };
  }

  // Status 400 with an application code that wasn't matched above — show server message as validation-like.
  if (status === 400) {
    return {
      category: 'validation',
      kind: 'error',
      title: 'Check your input',
      body: safeBody,
      placement: context.placement || 'inline',
      retryable: false,
      diagnostics: { ...diagnostics, category: 'validation' }
    };
  }

  return {
    category: 'unknown',
    kind: 'error',
    title: operationTitle(operation) || 'Action failed',
    body: safeBody,
    placement: context.placement || 'toast',
    retryable: Boolean(context.retryable),
    diagnostics
  };
}

function operationTitle(operation = '') {
  const map = {
    campaign: 'Campaign not saved',
    contacts: 'Contacts unavailable',
    inbox: 'Inbox unavailable',
    analytics: 'Insights unavailable',
    media: 'Upload failed',
    template: 'Template unavailable',
    billing: 'Billing update failed',
    team: 'Invite not sent',
    profile: 'Profile not updated',
    settings: 'Settings not saved',
    plan: 'Plan not saved'
  };
  return map[operation] || '';
}

/** Map classified error into toast notify options. */
export function toastOptionsFromError(error, context = {}) {
  const classified = classifyError(error, { ...context, placement: 'toast' });
  return {
    kind: classified.kind,
    title: classified.title,
    body: classified.body,
    sticky: classified.kind === 'error' || classified.kind === 'warning'
  };
}

export { sanitizeCustomerMessage };
