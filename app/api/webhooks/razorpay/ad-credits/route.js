import { adCreditsWebhook } from '@/lib/ad-credits.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  return adCreditsWebhook(request);
}
