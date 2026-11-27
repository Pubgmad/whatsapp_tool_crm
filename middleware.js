import { NextResponse } from 'next/server';
import {
  isReleaseApiPathBlocked,
  isReleaseAppPathBlocked,
  isReleaseFeatureSlugAllowed,
  isReleaseProductSlugAllowed,
  releaseBlockedResponse
} from './lib/release-feature-allowlist.js';

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

function blockedJson() {
  const body = releaseBlockedResponse('api');
  return NextResponse.json(
    { error: body.error, code: body.code },
    { status: body.status }
  );
}

/**
 * Super Admin auth rules:
 * 1) Leaving Super Admin via a top-level HTML navigation clears the session cookie.
 *    Asset/API/prefetch requests must NOT clear it (that caused post-login bounce loops).
 * 2) Document opens of protected /super-admin* pages without a cookie go to login.
 * 3) Login page is always reachable; a valid cookie is enough to enter the panel.
 *
 * WhatsApp Automation release: hard-block excluded CRM app/API/marketing paths.
 */
export function middleware(request) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    pathname === '/opengraph-image'
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    if (isReleaseApiPathBlocked(pathname)) return blockedJson();
    return NextResponse.next();
  }

  if (isReleaseAppPathBlocked(pathname)) {
    const accept = request.headers.get('accept') || '';
    if (accept.includes('text/html')) {
      return NextResponse.redirect(new URL('/app/onboarding', request.url));
    }
    return blockedJson();
  }

  if (pathname.startsWith('/features/')) {
    const slug = pathname.slice('/features/'.length).split('/')[0];
    if (slug && !isReleaseFeatureSlugAllowed(slug)) {
      return NextResponse.redirect(new URL('/features', request.url));
    }
  }

  if (pathname.startsWith('/products/')) {
    const slug = pathname.slice('/products/'.length).split('/')[0];
    if (slug && !isReleaseProductSlugAllowed(slug)) {
      return NextResponse.redirect(new URL('/products', request.url));
    }
  }

  const accept = request.headers.get('accept') || '';
  const isDocumentNavigation = accept.includes('text/html');
  const cookie = request.cookies.get(SUPER_SESSION_COOKIE_NAME)?.value;

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
