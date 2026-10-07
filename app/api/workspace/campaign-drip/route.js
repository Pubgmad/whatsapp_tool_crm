import { campaignDripRequest } from '@/lib/campaign-drip.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return campaignDripRequest(request);
}

export async function POST(request) {
  return campaignDripRequest(request);
}
