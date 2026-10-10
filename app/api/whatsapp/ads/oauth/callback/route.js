import { handleAdsOAuthCallback } from '@/lib/ads-meta-oauth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return handleAdsOAuthCallback(request);
}
