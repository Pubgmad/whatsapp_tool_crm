import { errorJson, json } from '@/lib/db';
import { requestPasswordReset } from '@/lib/account-security';
import { readJsonBodyLimited } from '@/lib/security';
export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    const body = await readJsonBodyLimited(request, 16384);
    await enforceRequestRateLimit(request, String(body.email || '').toLowerCase(), 'password');
    return json(await requestPasswordReset(body.email));
  } catch (error) { return errorJson(error); }
}
