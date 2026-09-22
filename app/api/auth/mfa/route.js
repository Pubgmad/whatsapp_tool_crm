import { errorJson, json } from '@/lib/db';
import { requireSession } from '@/lib/auth';
import { beginMfa, disableMfa, enableMfa, mfaStatus } from '@/lib/account-security';

export async function GET(request) {
  try {
    const session = await requireSession(request);
    return json(await mfaStatus(session.userId));
  } catch (error) { return errorJson(error); }
}

export async function POST(request) {
  try {
    const session = await requireSession(request);
    const body = await request.json();
    if (body.action === 'begin') return json(await beginMfa(session.userId));
    if (body.action === 'enable') return json(await enableMfa(session.userId, body.code));
    if (body.action === 'disable') return json(await disableMfa(session.userId, body.password, body.code));
    return json({ error: 'Invalid MFA action.', code: 'VALIDATION_ERROR' }, 400);
  } catch (error) { return errorJson(error); }
}
