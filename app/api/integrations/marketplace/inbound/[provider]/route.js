import { marketplaceInbound } from '@/lib/marketplace-connectors.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, context) {
  const params = await context?.params;
  const provider = params?.provider || new URL(request.url).pathname.split('/').pop();
  return marketplaceInbound(request, String(provider || ''));
}
