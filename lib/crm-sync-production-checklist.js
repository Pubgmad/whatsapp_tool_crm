import { query } from './db.js';

export async function crmSyncProductionChecklist(businessId) {
  const items = [];
  const connections = await query(
    'SELECT provider, enabled, last_sync_at, last_error, config FROM crm_connections WHERE business_id=$1',
    [businessId]
  );
  for (const row of connections.rows) {
    if (!row.enabled) continue;
    if (row.last_error) {
      items.push({
        id: `crm_${row.provider}_error`,
        area: 'integrations',
        title: `${row.provider} CRM sync`,
        status: 'open',
        detail: row.last_error,
        actions: ['Reconnect CRM', 'Review field map in Integrations']
      });
    } else if (!row.last_sync_at) {
      items.push({
        id: `crm_${row.provider}_initial`,
        area: 'integrations',
        title: `${row.provider} CRM initial sync`,
        status: 'open',
        detail: 'Never synced',
        actions: ['Run contact sync', 'Enable object sync after field review']
      });
    }
    const config = typeof row.config === 'string' ? JSON.parse(row.config || '{}') : row.config || {};
    if (!config.fieldMap || Object.keys(config.fieldMap).length === 0) {
      items.push({
        id: `crm_${row.provider}_fieldmap`,
        area: 'integrations',
        title: `${row.provider} field mapping`,
        status: 'open',
        detail: 'No explicit field map stored',
        actions: ['Configure field map via CRM settings API', 'Review outbound create toggle']
      });
    }
  }
  return items;
}
