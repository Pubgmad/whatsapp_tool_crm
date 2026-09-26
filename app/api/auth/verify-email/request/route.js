import { requestVerification } from '@/lib/account-security';
import { errorJson, json } from '@/lib/db';
import { readJsonBodyLimited } from '@/lib/security';

export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    const body = await readJsonBodyLimited(request, 16384);
    const email = String(body.email || '').trim().toLowerCase();
    await enforceRequestRateLimit(request, email, 'password');
    await requestVerification(email);
    return json({ ok: true });
  } catch (error) { return errorJson(error); }
}
