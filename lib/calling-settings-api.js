import { requireSession } from './auth.js';
import { AppError, query, json, errorJson, id } from './db.js';
import { readJsonBodyLimited } from './security.js';
import { validateCallingHours } from './calling-business-hours.js';
import { validateCallingPolicy as validateCallingAccess } from './whatsapp-calling.js';

export async function callingSettingsRequest(request) {
  try {
    const session = await requireSession(request);
    if (session.role !== 'Owner') throw new AppError('Only the owner can change calling settings.', 403, 'FORBIDDEN');
    if (request.method === 'GET') {
      const row = (await query('SELECT meta_connection_metadata FROM businesses WHERE id=$1', [session.businessId])).rows[0];
      const meta = row?.meta_connection_metadata || {};
      return json({
        callingAccess: meta.callingAccess || null,
        callingHours: meta.callingHours || { useSupportPolicy: true }
      });
    }
    const body = await readJsonBodyLimited(request, 32768);
    const callingHours = validateCallingHours(body.callingHours || { useSupportPolicy: true });
    const row = (await query('SELECT meta_connection_metadata FROM businesses WHERE id=$1', [session.businessId])).rows[0];
    const meta = row?.meta_connection_metadata || {};
    let callingAccess = meta.callingAccess;
    if (body.callingAccess) {
      callingAccess = validateCallingAccess(body.callingAccess);
    }
    const next = { ...meta, callingHours, ...(callingAccess ? { callingAccess } : {}) };
    await query('UPDATE businesses SET meta_connection_metadata=$1::jsonb, updated_at=NOW() WHERE id=$2', [JSON.stringify(next), session.businessId]);
    await query("INSERT INTO audit_logs (id,business_id,user_id,action) VALUES ($1,$2,$3,'calling_settings_updated')", [id('a'), session.businessId, session.userId]);
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  }
}
