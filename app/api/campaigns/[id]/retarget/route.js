import { getCampaignRetarget, postCampaignRetarget } from '@/lib/retargeting.js';
import { withWorkspaceFeature } from '@/lib/feature-controls.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, context) {
  return withWorkspaceFeature('segments', (req) => getCampaignRetarget(req, context))(request);
}

export async function POST(request, context) {
  return withWorkspaceFeature('segments', (req) => postCampaignRetarget(req, context))(request);
}
