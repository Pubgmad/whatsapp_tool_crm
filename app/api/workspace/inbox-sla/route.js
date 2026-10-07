import { inboxSlaDashboard } from '@/lib/inbox-sla-snapshot.js';
import { workspaceRoute } from '@/lib/workspace-route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_request, session) =>
  inboxSlaDashboard(session.businessId, session.userId, session.role)
);
