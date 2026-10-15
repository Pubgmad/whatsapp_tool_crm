import { NextResponse } from 'next/server';
import { completeGoogleLogin } from '@/lib/google-login-oauth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  try {
    const { enforceRequestRateLimit } = await import('@/lib/security');
    const { requestIp } = await import('@/lib/security');
    await enforceRequestRateLimit(request, `google-callback:${requestIp(request)}`, 'login', { identityOnly: true });
    if (url.searchParams.get('error')) {
      throw Object.assign(new Error('Google sign-in was cancelled.'), { status: 400 });
    }
    const result = await completeGoogleLogin({
      code: url.searchParams.get('code'),
      state: url.searchParams.get('state')
    });
    if (result.kind === 'mfa') {
      const response = NextResponse.redirect(new URL(result.nextPath, request.url), { status: 302 });
      response.headers.append('Set-Cookie', result.pendingCookie);
      return response;
    }
    const response = NextResponse.redirect(new URL(result.nextPath, request.url), { status: 302 });
    response.headers.append('Set-Cookie', result.cookie);
    return response;
  } catch (error) {
    const message = encodeURIComponent(error?.message || 'Google sign-in failed.');
    return NextResponse.redirect(new URL(`/login?auth_error=${message}`, request.url), { status: 302 });
  }
}
