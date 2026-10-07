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
      'This is your operator-controlled connector catalog—not a third-party app store. Zapier/Make/n8n connect through signed HTTPS webhooks and API keys you issue per workspace.'
  };
}

export async function workspaceIntegrationMarketplace(businessId) {
  const catalog = await getPlatformSettingValue('integration_catalog', defaultIntegrationCatalog());
  const flags = await workspaceFeatureFlags(businessId);
  const base = integrationMarketplaceCatalog(catalog);
  const connectors = base.connectors.filter((item) => !item.feature || flags[item.feature]);
  return { ...base, connectors };
}
