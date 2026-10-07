import { workspaceProductionHub } from '@/lib/workspace-production-hub.js';
import { workspaceRoute } from '@/lib/workspace-route.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_request, session) => workspaceProductionHub(session.businessId), { manager: true });
