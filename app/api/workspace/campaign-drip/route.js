import { campaignDripRequest } from '@/lib/campaign-drip.js';
import { withWorkspaceFeature } from '@/lib/feature-controls.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return withWorkspaceFeature('campaigns', campaignDripRequest)(request);
}

export async function POST(request) {
  return withWorkspaceFeature('campaigns', campaignDripRequest)(request);
}
