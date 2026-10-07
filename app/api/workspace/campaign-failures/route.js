import { campaignFailedRecipientsWorkbench } from '@/lib/campaign-failed-workbench.js';
import { workspaceRoute } from '@/lib/workspace-route.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session) => {
  const limit = Number(new URL(request.url).searchParams.get('limit') || 75);
  return campaignFailedRecipientsWorkbench(session.businessId, limit);
}, { manager: true });
