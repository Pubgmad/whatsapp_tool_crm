import { query } from './db.js';
import { workspaceIntegrationMarketplace } from './integration-marketplace.js';

export async function integrationLiveStatus(businessId) {
  const [connectors, crm, webhooks, keys] = await Promise.all([
    query(
      `SELECT provider,enabled,last_sync_at,last_error,created_at FROM provider_connectors WHERE business_id=$1 ORDER BY created_at`,
      [businessId]
    ),
    query(
      `SELECT provider,enabled,last_sync_at,last_error FROM crm_connections WHERE business_id=$1 ORDER BY created_at`,
      [businessId]
    ),
    query(
      `SELECT w.id,w.url,w.enabled,
        (SELECT d.status FROM workspace_webhook_deliveries d WHERE d.webhook_id=w.id ORDER BY d.created_at DESC LIMIT 1) AS last_delivery_status
       FROM workspace_webhooks w WHERE w.business_id=$1 ORDER BY w.created_at DESC LIMIT 10`,
      [businessId]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT id,name,last_used_at,revoked_at FROM workspace_api_keys WHERE business_id=$1 ORDER BY created_at DESC LIMIT 10`,
      [businessId]
    ).catch(() => ({ rows: [] }))
  ]);

  const marketplace = await workspaceIntegrationMarketplace(businessId);
  const connectorMap = new Map(connectors.rows.map((row) => [row.provider, row]));
  const crmMap = new Map(crm.rows.map((row) => [row.provider, row]));

  const connectorsEnriched = marketplace.connectors.map((item) => {
    const id = String(item.id || '');
    const live = connectorMap.get(id)
      || crmMap.get(id)
      || (id === 'razorpay_merchant' ? null : null)
      || (id.includes('hubspot') ? crmMap.get('hubspot') : null)
      || (id.includes('salesforce') ? crmMap.get('salesforce') : null);
    const webhookLive = id === 'workspace_webhooks' || id === 'webhooks'
      ? webhooks.rows.find((row) => row.enabled)
      : null;
    const keyLive = id === 'workspace_api' || id === 'api_keys'
      ? keys.rows.find((row) => !row.revoked_at)
      : null;
    const connected = Boolean(live?.enabled || webhookLive || keyLive);
    return {
      ...item,
      connected,
      lastSyncAt: live?.last_sync_at || null,
      lastError: live?.last_error || ''
    };
  });

  return {
    connectors: connectorsEnriched,
    crm: crm.rows,
    outboundWebhooks: webhooks.rows,
    apiKeys: keys.rows.map((row) => ({
      id: row.id,
      name: row.name,
      lastUsedAt: row.last_used_at,
      active: !row.revoked_at
    })),
    recipes: marketplace.recipes
  };
}
