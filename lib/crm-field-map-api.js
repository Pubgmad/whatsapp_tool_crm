import { AppError, query, json, errorJson } from './db.js';
import { requireSession } from './auth.js';
import { assertWorkspaceFeature } from './feature-controls.js';

/** Read-only mirror of live crm_field_mappings. Writes go through /api/crm/* map_field. */
export async function crmFieldMapRequest(request) {
  try {
    const session = await requireSession(request);
    if (session.role !== 'Owner') throw new AppError('Only the owner can edit CRM field maps.', 403, 'FORBIDDEN');
    await assertWorkspaceFeature('crm_sync', session.businessId);
    const provider = String(new URL(request.url).searchParams.get('provider') || '').toLowerCase();
    if (!['hubspot', 'salesforce'].includes(provider)) throw new AppError('Specify hubspot or salesforce.', 400, 'VALIDATION_ERROR');
    const connection = (await query(
      'SELECT id, config FROM crm_connections WHERE business_id=$1 AND provider=$2',
      [session.businessId, provider]
    )).rows[0];
    if (!connection) throw new AppError('Connect CRM first.', 404, 'NOT_FOUND');
    if (request.method === 'GET') {
      const mappings = (await query(
        'SELECT kind,source_field,attribute_key,push_enabled,enabled FROM crm_field_mappings WHERE business_id=$1 AND connection_id=$2 ORDER BY kind,source_field',
        [session.businessId, connection.id]
      )).rows;
      const config = typeof connection.config === 'string' ? JSON.parse(connection.config || '{}') : connection.config || {};
      return json({
        provider,
        mappings,
        outboundCreate: Boolean(config.outboundCreate),
        syncObjects: config.syncObjects || []
      });
    }
    throw new AppError(
      'Update field mappings from HubSpot or Salesforce settings in Integrations.',
      405,
      'CRM_FIELD_MAP_USE_CONNECTION_SETTINGS'
    );
  } catch (error) {
    return errorJson(error);
  }
}
