import { workspaceRoute } from '@/lib/workspace-route.ts';
import { loadWorkspaceGroupsInbox } from '@/lib/workspace-groups-inbox.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session) => {
  const limit = Number(new URL(request.url).searchParams.get('limit')) || 50;
  return loadWorkspaceGroupsInbox(session.businessId, { limit });
});
