import { NextResponse } from 'next/server';

const SUPER_SESSION_COOKIE_NAME = 'wcrm_super_session';

/**
 * Super Admin must re-authenticate after leaving admin pages.
 * Clear the session cookie on any non-admin document navigation.
 * API routes are left alone so in-panel fetches (/api/platform, CSRF) keep working.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith('/super-admin') ||
    pathname.startsWith('/api/super-admin') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/favicon.ico' ||
    pathname === '/opengraph-image'
  ) {
    return NextResponse.next();
  }

  if (!request.cookies.get(SUPER_SESSION_COOKIE_NAME)?.value) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set({
    name: SUPER_SESSION_COOKIE_NAME,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:'
  });
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)']
};
