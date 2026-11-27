import { filterIntegrationCatalog } from './release-feature-allowlist.js';

function fullIntegrationCatalog() {
  return [
    { id: 'zapier', label: 'Zapier (webhook recipe)', kind: 'recipe', category: 'automation', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'shopify', label: 'Shopify', kind: 'oauth', category: 'commerce', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'woocommerce', label: 'WooCommerce', kind: 'webhook', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'google_calendar', label: 'Google Calendar', kind: 'oauth', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'hubspot', label: 'HubSpot CRM', kind: 'oauth', feature: 'crm_sync', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'salesforce', label: 'Salesforce CRM', kind: 'oauth', feature: 'crm_sync', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'workspace_webhooks', label: 'Signed workspace webhooks', kind: 'api', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'workspace_api_keys', label: 'Workspace API keys', kind: 'api', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'dialogflow', label: 'Dialogflow CX', kind: 'platform', feature: 'dialogflow_bot', docsPath: '/app/ai-agents', status: 'available' },
    { id: 'razorpay_merchant', label: 'Razorpay merchant checkout', kind: 'psp', feature: 'commerce', docsPath: '/app/settings/billing', status: 'available' },
    { id: 'google_sheets', label: 'Google Sheets bots', kind: 'oauth', feature: 'sheets_bot', docsPath: '/app/bots', status: 'available' },
    { id: 'make', label: 'Make (webhook recipe)', kind: 'recipe', category: 'automation', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' },
    { id: 'pabbly', label: 'Pabbly Connect (webhook recipe)', kind: 'recipe', category: 'automation', feature: 'connectors', docsPath: '/app/settings/integrations', status: 'available' }
  ];
}

/** Automation-only catalogue (Shopify/Woo/CRM/merchant commerce removed). */
export function defaultIntegrationCatalog() {
  return filterIntegrationCatalog(fullIntegrationCatalog());
}
