export function defaultIntegrationCatalog() {
  return [
    { id: 'shopify', label: 'Shopify', kind: 'oauth', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'woocommerce', label: 'WooCommerce', kind: 'webhook', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'google_calendar', label: 'Google Calendar', kind: 'oauth', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'hubspot', label: 'HubSpot CRM', kind: 'oauth', feature: 'crm_sync', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'salesforce', label: 'Salesforce CRM', kind: 'oauth', feature: 'crm_sync', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'workspace_webhooks', label: 'Signed workspace webhooks', kind: 'api', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'workspace_api_keys', label: 'Workspace API keys', kind: 'api', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'dialogflow', label: 'Dialogflow CX', kind: 'platform', feature: 'dialogflow_bot', docsPath: '/app/settings/team', status: 'available' },
    { id: 'razorpay_merchant', label: 'Razorpay merchant checkout', kind: 'psp', feature: 'commerce', docsPath: '/app/settings/billing', status: 'available' }
  ];
}
