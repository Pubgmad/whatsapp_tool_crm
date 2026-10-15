import { clearGoogleMfaPendingCookie, completeGoogleMfa } from '@/lib/google-login-oauth.js';
import { parseCookies } from '@/lib/auth.js';
import { errorJson } from '@/lib/db';
import { readJsonBodyLimited } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    const body = await readJsonBodyLimited(request, 8192);
    await enforceRequestRateLimit(request, String(body.email || 'google-mfa').toLowerCase(), 'login');
    const pendingToken = parseCookies(request).wcrm_google_mfa || body.pendingToken;
    const session = await completeGoogleMfa({ pendingToken, mfaCode: body.mfaCode || body.code });
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', session);
    headers.append('Set-Cookie', clearGoogleMfaPendingCookie());
    return Response.json({ ok: true }, { status: 200, headers });
  } catch (error) {
    return errorJson(error);
  }
}
