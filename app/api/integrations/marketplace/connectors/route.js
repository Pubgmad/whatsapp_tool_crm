import { listMarketplaceConnectors, manageMarketplaceConnector } from '@/lib/marketplace-connectors.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return listMarketplaceConnectors(request);
}

export async function POST(request) {
  return manageMarketplaceConnector(request);
}
