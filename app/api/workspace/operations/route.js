import { workspaceOperationsReport } from '@/lib/workspace-operations-report.js';
import { workspaceRoute } from '@/lib/workspace-route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_request, session) => workspaceOperationsReport(session.businessId), { manager: true });
