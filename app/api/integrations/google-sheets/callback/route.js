import { NextResponse } from 'next/server';
import { completeSheetsOAuth } from '@/lib/sheets-bot.js';

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
      throw Object.assign(new Error('Google Sheets authorization was cancelled.'), { status: 400 });
    }
    await completeSheetsOAuth(request, url);
    return NextResponse.redirect(new URL('/app/bots?sheets=connected', origin), { status: 302 });
  } catch (error) {
    const message = encodeURIComponent(error?.message || 'Google Sheets connection failed.');
    return NextResponse.redirect(new URL(`/app/bots?sheets_error=${message}`, origin), { status: 302 });
  }
}
