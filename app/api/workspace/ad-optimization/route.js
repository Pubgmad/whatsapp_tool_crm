import { adOptimizationSuggestionsRequest } from '@/lib/ad-optimization-suggestions.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return adOptimizationSuggestionsRequest(request);
}

export async function POST(request) {
  return adOptimizationSuggestionsRequest(request);
}
