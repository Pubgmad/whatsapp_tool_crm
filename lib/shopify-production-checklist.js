import { query } from './db.js';

export async function shopifyProductionChecklist(businessId) {
  const items = [];
  const connector = (
    await query(
      `SELECT id, enabled, last_error, config FROM provider_connectors WHERE business_id=$1 AND provider='shopify' ORDER BY created_at DESC LIMIT 1`,
      [businessId]
    )
  ).rows[0];
  if (!connector) return items;
  if (!connector.enabled) {
    items.push({
      id: 'shopify_disabled',
      area: 'integrations',
      title: 'Shopify connector',
      status: 'open',
      detail: 'Connector exists but disabled',
      actions: ['Enable connector in Integrations']
    });
    return items;
  }
  if (connector.last_error) {
    items.push({
      id: 'shopify_error',
      area: 'integrations',
      title: 'Shopify connector health',
      status: 'open',
      detail: connector.last_error,
      actions: ['Reconnect Shopify OAuth', 'Verify read_orders scope']
    });
  }
  const oauthConfigured = Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
  if (!oauthConfigured && !connector.config?.accessToken) {
    items.push({
      id: 'shopify_oauth',
      area: 'integrations',
      title: 'Shopify OAuth',
      status: 'open',
      detail: 'Platform Shopify OAuth env not set and no stored token',
      actions: ['Set SHOPIFY_CLIENT_ID/SECRET on VPS', 'Complete OAuth connect flow']
    });
  }
  items.push({
    id: 'shopify_webhooks',
    area: 'integrations',
    title: 'Shopify order webhooks',
    status: 'open',
    detail: 'Register orders/updated and refunds/create to connector events URL',
    actions: ['Copy connector webhook URL from Integrations', 'Register in Shopify admin']
  });
  return items;
}
