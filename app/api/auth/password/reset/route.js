import { errorJson, json } from '@/lib/db';
import { resetPassword } from '@/lib/account-security';
import { readJsonBodyLimited } from '@/lib/security';
export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    await enforceRequestRateLimit(request, 'password-reset', 'password');
    const body = await readJsonBodyLimited(request, 16384);
    return json(await resetPassword(body.token, body.password));
  } catch (error) { return errorJson(error); }
}
