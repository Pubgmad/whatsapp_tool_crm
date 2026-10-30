import { NextResponse } from 'next/server';
import { completeZohoOAuth } from '@/lib/marketplace-connectors.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  try {
    if (url.searchParams.get('error')) {
      throw Object.assign(new Error('Zoho authorization was cancelled.'), { status: 400 });
    }
    await completeZohoOAuth(url);
    return NextResponse.redirect(new URL('/app/settings/integrations?zoho=connected', request.url), { status: 302 });
  } catch (error) {
    const message = encodeURIComponent(error?.message || 'Zoho connection failed.');
    return NextResponse.redirect(new URL(`/app/settings/integrations?zoho_error=${message}`, request.url), { status: 302 });
  }
}
