import { errorJson, json } from '@/lib/db';
import { verifyEmail } from '@/lib/account-security';
export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    await enforceRequestRateLimit(request, 'verify-email', 'password');
    const body = await request.json();
    return json(await verifyEmail(body.token));
  } catch (error) { return errorJson(error); }
}
