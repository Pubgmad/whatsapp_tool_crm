import { requireSession } from '@/lib/auth';
import { requestCoexistenceSync } from '@/lib/coexistence';
import { AppError, errorJson, json, query } from '@/lib/db';
import { readJsonBodyLimited } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const session = await requireSession(request);
    if (!['Owner', 'Manager'].includes(session.role)) throw new AppError('Only workspace owners and managers can request sync.', 403, 'FORBIDDEN');
    const body = await readJsonBodyLimited(request, 4096);
    const phoneId = String(body.phoneId || '');
    const phone = (await query('SELECT phone_number_id FROM whatsapp_phone_numbers WHERE id=$1 AND business_id=$2', [phoneId, session.businessId])).rows[0];
    if (!phone) throw new AppError('Connected number not found.', 404, 'NOT_FOUND');
    return json({ ok: true, sync: await requestCoexistenceSync(session.businessId, phone.phone_number_id, body.kind) });
  } catch (error) { return errorJson(error); }
}
