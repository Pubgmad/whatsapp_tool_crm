import { NextResponse } from 'next/server';
import { completeZohoOAuth } from '@/lib/marketplace-connectors.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function publicAppOrigin(request) {
  const configured = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  return new URL(request.url).origin;
}

export async function GET(request) {
  const url = new URL(request.url);
  const origin = publicAppOrigin(request);
  try {
    if (url.searchParams.get('error')) {
      throw Object.assign(new Error('Zoho authorization was cancelled.'), { status: 400 });
    }
    await completeZohoOAuth(url);
    return NextResponse.redirect(new URL('/app/settings/integrations?zoho=connected', origin), { status: 302 });
  } catch (error) {
    const message = encodeURIComponent(error?.message || 'Zoho connection failed.');
    return NextResponse.redirect(new URL(`/app/settings/integrations?zoho_error=${message}`, origin), { status: 302 });
  }
}
