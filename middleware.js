import { NextResponse } from 'next/server';

const SUPER_SESSION_COOKIE_NAME = 'wcrm_super_session';

function clearSuperCookie(response, request) {
  response.cookies.set({
    name: SUPER_SESSION_COOKIE_NAME,
    value: '',
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:'
  });
}

/**
 * Super Admin auth rules:
 * 1) Leaving Super Admin via a top-level HTML navigation clears the session cookie.
 *    Asset/API/prefetch requests must NOT clear it (that caused post-login bounce loops).
 * 2) Document opens of protected /super-admin* pages without a cookie go to login.
 * 3) Login page is always reachable; a valid cookie is enough to enter the panel.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl;
  const cookie = request.cookies.get(SUPER_SESSION_COOKIE_NAME)?.value;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/favicon.ico' ||
    pathname === '/opengraph-image'
  ) {
    return NextResponse.next();
  }

  const accept = request.headers.get('accept') || '';
  const isDocumentNavigation = accept.includes('text/html');

  // Left the Super Admin area on a real page navigation → drop session.
  if (!pathname.startsWith('/super-admin')) {
    if (!cookie || !isDocumentNavigation) return NextResponse.next();
    const response = NextResponse.next();
    clearSuperCookie(response, request);
    return response;
  }

  // Login remains reachable whether or not a cookie exists.
  if (pathname === '/super-admin/login' || pathname.startsWith('/super-admin/login/')) {
    return NextResponse.next();
  }

  if (isDocumentNavigation && !cookie) {
    return NextResponse.redirect(new URL('/super-admin/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)']
};
