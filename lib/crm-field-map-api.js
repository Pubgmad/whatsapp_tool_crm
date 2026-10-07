import { AppError, query, transaction, id, json, errorJson } from './db.js';
import { requireSession } from './auth.js';
import { readJsonBodyLimited } from './security.js';

const ALLOWED_FIELDS = new Set(['email', 'phone', 'name', 'company', 'lifecycle', 'deal_stage', 'custom']);

export async function crmFieldMapRequest(request) {
  try {
    const session = await requireSession(request);
    if (session.role !== 'Owner') throw new AppError('Only the owner can edit CRM field maps.', 403, 'FORBIDDEN');
    const provider = String(new URL(request.url).searchParams.get('provider') || '').toLowerCase();
    if (!['hubspot', 'salesforce'].includes(provider)) throw new AppError('Specify hubspot or salesforce.', 400, 'VALIDATION_ERROR');
    if (request.method === 'GET') {
      const row = (await query('SELECT config FROM crm_connections WHERE business_id=$1 AND provider=$2', [session.businessId, provider])).rows[0];
      const config = typeof row?.config === 'string' ? JSON.parse(row.config || '{}') : row?.config || {};
      return json({ provider, fieldMap: config.fieldMap || {}, outboundCreate: Boolean(config.outboundCreate), syncObjects: config.syncObjects || [] });
    }
    const body = await readJsonBodyLimited(request, 65536);
    const fieldMap = body.fieldMap && typeof body.fieldMap === 'object' ? body.fieldMap : {};
    for (const key of Object.keys(fieldMap)) {
      if (!ALLOWED_FIELDS.has(key) && !key.startsWith('custom_')) throw new AppError(`Invalid map key ${key}.`, 400, 'VALIDATION_ERROR');
    }
    await transaction(async (client) => {
      const current = (await client.query('SELECT config FROM crm_connections WHERE business_id=$1 AND provider=$2 FOR UPDATE', [session.businessId, provider])).rows[0];
      if (!current) throw new AppError('Connect CRM first.', 404, 'NOT_FOUND');
      const config = typeof current.config === 'string' ? JSON.parse(current.config || '{}') : current.config || {};
      config.fieldMap = fieldMap;
      if (typeof body.outboundCreate === 'boolean') config.outboundCreate = body.outboundCreate;
      await client.query('UPDATE crm_connections SET config=$1::jsonb, updated_at=NOW() WHERE business_id=$2 AND provider=$3', [JSON.stringify(config), session.businessId, provider]);
      await client.query("INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,'crm_field_map_updated',$4)", [
        id('a'),
        session.businessId,
        session.userId,
        JSON.stringify({ provider })
      ]);
    });
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}
