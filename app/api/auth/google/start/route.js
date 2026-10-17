import { NextResponse } from 'next/server';
import { errorJson, json } from '@/lib/db';
import { DEFAULT_POST_AUTH_PATH } from '@/lib/auth-return.js';
import { googleLoginConfigured, startGoogleLogin } from '@/lib/google-login-oauth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { enforceRequestRateLimit } = await import('@/lib/security');
    const url = new URL(request.url);
    if (url.searchParams.get('probe') === '1') {
      return json({ enabled: googleLoginConfigured() });
    }
    const { requestIp } = await import('@/lib/security');
    await enforceRequestRateLimit(request, `google-start:${requestIp(request)}`, 'login', { identityOnly: true });
    const mode = url.searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
    const nextPath = url.searchParams.get('next') || DEFAULT_POST_AUTH_PATH;
    const started = await startGoogleLogin({ mode, nextPath });
    return NextResponse.redirect(started.url, { status: 302 });
  } catch (error) {
    if (String(request.url).includes('probe=1')) return errorJson(error);
    const message = encodeURIComponent(error?.message || 'Google sign-in is unavailable.');
    const mode = new URL(request.url).searchParams.get('mode') === 'signup' ? 'signup' : 'login';
    return NextResponse.redirect(new URL(`/${mode}?auth_error=${message}`, request.url), { status: 302 });
  }
}
