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

function isSameOriginAdminReferer(request) {
  const referer = request.headers.get('referer') || '';
  if (!referer) return false;
  try {
    const ref = new URL(referer);
    return ref.origin === request.nextUrl.origin && ref.pathname.startsWith('/super-admin');
  } catch {
    return false;
  }
}

/** True for in-app navigations that should keep the Super Admin session. */
function isTrustedAdminNavigation(request) {
  if (isSameOriginAdminReferer(request)) return true;
  // Post-login window.location.replace often has Referer stripped by proxies/browsers.
  // Typed URLs and external returns use sec-fetch-site: none / cross-site.
  const site = (request.headers.get('sec-fetch-site') || '').toLowerCase();
  const mode = (request.headers.get('sec-fetch-mode') || '').toLowerCase();
  return site === 'same-origin' && (mode === 'navigate' || mode === 'nested-navigate' || mode === '');
}

/**
 * Super Admin auth rules:
 * 1) Leaving any non-admin page clears the Super Admin cookie.
 * 2) Full document opens of /super-admin* from outside (typed URL, external return, new tab)
 *    force login again — even if a cookie still exists.
 * 3) Same-origin navigations (including post-login redirect) keep the session.
 * Client navigations inside the panel (RSC / fetch) keep the session.
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

  // Left the Super Admin area entirely → drop session.
  if (!pathname.startsWith('/super-admin')) {
    if (!cookie) return NextResponse.next();
    const response = NextResponse.next();
    clearSuperCookie(response, request);
    return response;
  }

  // Login page: always reachable, but drop any leftover cookie unless navigation
  // came from inside Super Admin (otherwise typed URL / external return would auto-enter).
  if (pathname === '/super-admin/login' || pathname.startsWith('/super-admin/login/')) {
    const accept = request.headers.get('accept') || '';
    const isDocumentNavigation = accept.includes('text/html');
    if (isDocumentNavigation && cookie && !isTrustedAdminNavigation(request)) {
      const response = NextResponse.next();
      clearSuperCookie(response, request);
      return response;
    }
    return NextResponse.next();
  }

  // Full HTML document navigation into admin from outside → re-auth.
  const accept = request.headers.get('accept') || '';
  const isDocumentNavigation = accept.includes('text/html');
  if (isDocumentNavigation && cookie && !isTrustedAdminNavigation(request)) {
    const response = NextResponse.redirect(new URL('/super-admin/login', request.url));
    clearSuperCookie(response, request);
    return response;
  }

  if (isDocumentNavigation && !cookie) {
    return NextResponse.redirect(new URL('/super-admin/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)']
};
