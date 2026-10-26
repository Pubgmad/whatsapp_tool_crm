export const MM_API_OPTIMIZER_FEATURES = Object.freeze([
  { id: 'quality_delivery', label: 'Quality-based delivery', managedIn: 'meta' },
  { id: 'creative_optimization', label: 'Automated creative optimization (pilot)', managedIn: 'meta' },
  { id: 'performance_benchmarks', label: 'Performance benchmarks', managedIn: 'meta' },
  { id: 'time_to_live', label: 'Marketing message time-to-live', managedIn: 'meta' },
  { id: 'conversion_metrics', label: 'App / web conversion metrics', managedIn: 'meta' }
]);

export function marketingMessagesReadiness(accountOrCapabilities) {
  const capabilities = accountOrCapabilities?.capabilities || accountOrCapabilities || {};
  const status = String(capabilities.marketing_messages_api?.status || 'UNKNOWN');
  return {
    sendPathReady: status === 'ONBOARDED',
    status,
    optimizerFeatures: MM_API_OPTIMIZER_FEATURES,
    operatorNote:
      'This CRM uses the Marketing Messages send path when Meta has approved the WhatsApp account. Time-to-live, benchmarks, and creative optimization are controlled in Meta—not duplicated here.'
  };
}
