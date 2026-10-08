const CRM_ERROR_CATALOG = Object.freeze({
  CRM_REAUTHORIZE: {
    message: 'The CRM authorization expired or was revoked. Reconnect the CRM account.',
    actions: ['Reconnect CRM']
  },
  CRM_SCOPE_MISSING: {
    message: 'The connected CRM account did not grant all required permissions.',
    actions: ['Reconnect CRM and approve every requested permission', 'Ask a CRM administrator to review app access']
  },
  CRM_ACCOUNT_PERMISSION_REQUIRED: {
    message: 'The installing user does not have permission to authorize this CRM access.',
    actions: ['Ask a CRM Super Admin or app marketplace administrator to connect the account']
  },
  CRM_PLAN_FEATURE_UNAVAILABLE: {
    message: 'The requested CRM feature is not available for this customer account or subscription.',
    actions: ['Review the customer CRM plan', 'Disable the unavailable object-sync feature']
  },
  CRM_ACCOUNT_ACCESS_DENIED: {
    message: 'The CRM account denied this operation.',
    actions: ['Ask a CRM Super Admin to review user and app permissions']
  },
  CRM_RATE_LIMIT: {
    message: 'The CRM provider rate limit was reached. Synchronization will retry automatically.',
    actions: ['Wait for the automatic retry']
  },
  CRM_UNREACHABLE: {
    message: 'The CRM provider is temporarily unreachable.',
    actions: ['Retry later', 'Check provider status']
  },
  CRM_PROVIDER_ERROR: {
    message: 'The CRM provider rejected the request.',
    actions: ['Review the integration settings', 'Retry the synchronization']
  },
  CRM_AUTH_CANCELLED: {
    message: 'CRM authorization was cancelled. No connection changes were made.',
    actions: ['Start the connection again when ready']
  },
  CRM_APP_CONFIGURATION: {
    message: 'The CRM OAuth application configuration is invalid.',
    actions: ['Ask the platform administrator to review redirect URLs, scopes, and credentials']
  }
});

export function crmErrorGuidance(code, provider = 'CRM') {
  const entry = CRM_ERROR_CATALOG[String(code || '')] || {
    message: `${provider} synchronization needs attention.`,
    actions: ['Review the integration status', 'Retry the synchronization']
  };
  return { code: String(code || ''), message: entry.message.replaceAll('CRM', provider), actions: [...entry.actions] };
}
