export function marketingMessagesStatus(capabilities) {
  const status = capabilities?.marketing_messages_api?.status || 'UNKNOWN';
  if (status === 'ONBOARDED') {
    return { ready: true, status, message: 'Marketing Messages API is onboarded for this WABA.' };
  }
  if (status === 'ELIGIBLE') {
    return { ready: false, status, message: 'Complete Marketing Messages onboarding in Meta Setup before sending.' };
  }
  return {
    ready: false,
    status,
    message: 'Marketing Messages API is not onboarded. Use Cloud API delivery or refresh entitlements after Meta approval.'
  };
}
