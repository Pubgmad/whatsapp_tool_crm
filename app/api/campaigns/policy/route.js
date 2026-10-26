import { campaignPolicyEndpoint } from '@/lib/campaign-controls';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return withWorkspaceFeature('campaigns', campaignPolicyEndpoint)(request);
}

export async function PUT(request) {
  return withWorkspaceFeature('campaigns', campaignPolicyEndpoint)(request);
}
