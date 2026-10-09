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
  const lifecycle = (
    await query(
      `SELECT webhook_status FROM availability_connections
       WHERE business_id=$1 AND provider='shopify' AND source=$2 ORDER BY updated_at DESC LIMIT 1`,
      [businessId, connector.source]
    )
  ).rows[0]?.webhook_status;
  if (lifecycle?.state !== 'active') {
    items.push({
      id: 'shopify_webhooks',
      area: 'integrations',
      title: 'Shopify webhook lifecycle',
      status: 'open',
      detail: lifecycle?.state === 'privacy_action_required'
        ? `Order webhooks are active. Configure mandatory privacy topics with callback ${lifecycle.privacyCallbackUrl}.`
        : 'Webhook subscriptions are missing or need repair.',
      actions: ['Repair webhooks from Shopify availability settings', 'Reauthorize Shopify if repair fails']
    });
  }
  return items;
}
