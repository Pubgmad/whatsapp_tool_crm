import { workspaceLiveMetaReadiness } from '@/lib/live-meta-readiness.js';
import { workspaceRoute } from '@/lib/workspace-route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_request, session) => {
  return workspaceLiveMetaReadiness(session.businessId);
});
