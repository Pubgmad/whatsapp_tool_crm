import { requestVerification } from '@/lib/account-security';
import { errorJson, json } from '@/lib/db';

export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    await enforceRequestRateLimit(request, email, 'password');
    await requestVerification(email);
    return json({ ok: true });
  } catch (error) { return errorJson(error); }
}
