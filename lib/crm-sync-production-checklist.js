import { query } from './db.js';
import { crmErrorGuidance } from './crm-error-catalog.js';

export async function crmSyncProductionChecklist(businessId) {
  const items = [];
  const connections = await query(
    'SELECT id, provider, enabled, last_sync_at, last_error, config FROM crm_connections WHERE business_id=$1',
    [businessId]
  );
  for (const row of connections.rows) {
    if (!row.enabled) continue;
    if (row.last_error) {
      const guidance = crmErrorGuidance(row.last_error, row.provider === 'hubspot' ? 'HubSpot' : 'Salesforce');
      items.push({
        id: `crm_${row.provider}_error`,
        area: 'integrations',
        title: `${row.provider} CRM sync`,
        status: 'open',
        detail: guidance.message,
        actions: guidance.actions
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
    const legacyFieldMap = config.fieldMap && Object.keys(config.fieldMap).length > 0;
    const tableMappings = legacyFieldMap ? 1 : (await query(
      'SELECT COUNT(*)::int AS count FROM crm_field_mappings WHERE business_id=$1 AND connection_id=$2',
      [businessId, row.id]
    )).rows[0]?.count || 0;
    if (!legacyFieldMap && !tableMappings) {
      items.push({
        id: `crm_${row.provider}_fieldmap`,
        area: 'integrations',
        title: `${row.provider} field mapping`,
        status: 'open',
        detail: 'No CRM field mappings configured',
        actions: ['Map contact attributes in CRM settings', 'Review outbound create toggle']
      });
    }
  }
  return items;
}
