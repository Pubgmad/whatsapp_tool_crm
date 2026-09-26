import { errorJson, json } from '@/lib/db';
import { verifyEmail } from '@/lib/account-security';
import { readJsonBodyLimited } from '@/lib/security';
export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    await enforceRequestRateLimit(request, 'verify-email', 'password');
    const body = await readJsonBodyLimited(request, 16384);
    return json(await verifyEmail(body.token));
  } catch (error) { return errorJson(error); }
}
