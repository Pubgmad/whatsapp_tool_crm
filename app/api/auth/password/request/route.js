import { errorJson, json } from '@/lib/db';
import { requestPasswordReset } from '@/lib/account-security';
export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    const body = await request.json();
    await enforceRequestRateLimit(request, String(body.email || '').toLowerCase(), 'password');
    return json(await requestPasswordReset(body.email));
  } catch (error) { return errorJson(error); }
}
