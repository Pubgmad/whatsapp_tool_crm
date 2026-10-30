import { NextResponse } from 'next/server';
import { completeSheetsOAuth } from '@/lib/sheets-bot.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  try {
    if (url.searchParams.get('error')) {
      throw Object.assign(new Error('Google Sheets authorization was cancelled.'), { status: 400 });
    }
    await completeSheetsOAuth(request, url);
    return NextResponse.redirect(new URL('/app/bots?sheets=connected', request.url), { status: 302 });
  } catch (error) {
    const message = encodeURIComponent(error?.message || 'Google Sheets connection failed.');
    return NextResponse.redirect(new URL(`/app/bots?sheets_error=${message}`, request.url), { status: 302 });
  }
}
