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

  const connectorsEnriched = marketplace.connectors.map((item) => {
    const live = connectorMap.get(item.id) || connectorMap.get(item.id === 'hubspot' ? 'hubspot' : item.id);
    return {
      ...item,
      connected: Boolean(live?.enabled),
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
