import { workspaceRoute } from '@/lib/workspace-route.ts';
import { workspaceProductionPending } from '@/lib/production-pending-report.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_request, session) => workspaceProductionPending(session.businessId), { manager: true });
