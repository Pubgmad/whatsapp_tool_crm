import { getPlatformSettingValue } from './platform.js';
import { defaultIntegrationCatalog } from './integration-catalog-data.js';
import { workspaceFeatureFlags } from './feature-controls.js';

const RECIPES = Object.freeze([
  {
    id: 'zapier_webhook',
    label: 'Zapier (via signed webhooks)',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Forward CRM events to Zapier Webhooks or REST hooks using workspace signing secrets.',
    steps: ['Create a Zap with Webhooks by Zapier → Catch Hook', 'Add a signed outbound webhook in Integrations', 'Map event payloads to your Zap actions']
  },
  {
    id: 'make_webhook',
    label: 'Make (Integromat)',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Use Make custom webhook modules with the same signed workspace webhooks.',
    steps: ['Create a Custom Webhook module in Make', 'Paste the HTTPS URL from Integrations', 'Verify X-Signature headers using your signing secret']
  },
  {
    id: 'n8n_webhook',
    label: 'n8n',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Trigger n8n workflows from conversation, contact, and campaign events.',
    steps: ['Add a Webhook node in n8n', 'Register the URL under workspace webhooks', 'Filter on eventTypes in the payload']
  },
  {
    id: 'pabbly_webhook',
    label: 'Pabbly Connect',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Route CRM events into Pabbly workflows via signed HTTPS webhooks.',
    steps: ['Create a workflow with a Webhook trigger in Pabbly', 'Add the URL in Integrations → Webhooks', 'Verify signature header']
  },
  {
    id: 'integrately_webhook',
    label: 'Integrately',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Start Integrately automations from signed Growth Desk event payloads.',
    steps: ['Choose a webhook trigger in Integrately', 'Register its HTTPS URL in Integrations', 'Map schemaVersion, eventType, and data fields']
  },
  {
    id: 'pipedream_webhook',
    label: 'Pipedream',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Verify signed events in Pipedream and call thousands of supported APIs.',
    steps: ['Create an HTTP/Webhook source', 'Verify timestamp and HMAC signature in a code step', 'Connect the event to a Pipedream action']
  },
  {
    id: 'workato_webhook',
    label: 'Workato',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Feed versioned CRM events into enterprise Workato recipes.',
    steps: ['Create a recipe with an HTTP webhook trigger', 'Add the callback URL as a signed webhook', 'Validate the v1 signature before processing']
  },
  {
    id: 'albato_webhook',
    label: 'Albato',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Route Growth Desk events through Albato custom webhooks.',
    steps: ['Create an Albato incoming webhook', 'Subscribe it to selected Growth Desk events', 'Map contact, order, campaign, or flow data']
  },
  {
    id: 'slack_webhook',
    label: 'Slack notifications',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Post SLA breaches and campaign failures to Slack incoming webhooks.',
    steps: ['Create a Slack incoming webhook', 'Allow hooks.slack.com in WORKSPACE_WEBHOOK_ALLOWED_HOSTS', 'Subscribe to support_sla_breached events']
  },
  {
    id: 'google_sheets_webhook',
    label: 'Google Sheets (via automation platform)',
    category: 'automation',
    kind: 'recipe',
    status: 'available',
    summary: 'Append rows through Zapier/Make/n8n; not a native Sheets OAuth app.',
    steps: ['Use Zapier/Make to append rows', 'Trigger from workspace webhook events', 'Map contact and campaign fields']
  }
]);

export function integrationMarketplaceCatalog(catalog = defaultIntegrationCatalog()) {
  const connectors = (Array.isArray(catalog) ? catalog : defaultIntegrationCatalog()).map((item) => ({
    ...item,
    category: item.category || (item.kind === 'oauth' ? 'crm' : item.kind === 'webhook' ? 'commerce' : 'platform')
  }));
  return {
    connectors,
    recipes: RECIPES,
    categories: [
      { id: 'crm', label: 'CRM & data' },
      { id: 'commerce', label: 'Commerce' },
      { id: 'automation', label: 'Automation platforms' },
      { id: 'platform', label: 'Platform APIs' }
    ],
    operatorNote:
      'This is an operator-controlled connector catalog. Automation platforms connect through versioned signed webhooks and scoped API keys; listing a recipe does not claim a native third-party marketplace app.'
  };
}

export async function workspaceIntegrationMarketplace(businessId) {
  const catalog = await getPlatformSettingValue('integration_catalog', defaultIntegrationCatalog());
  const flags = await workspaceFeatureFlags(businessId);
  const base = integrationMarketplaceCatalog(catalog);
  const connectors = base.connectors.filter((item) => !item.feature || flags[item.feature]);
  return { ...base, connectors };
}
