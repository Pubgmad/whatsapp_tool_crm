import { buildPlatformParityReport } from '@/lib/parity-report.js';
import { workspaceRoute } from '@/lib/workspace-route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_request, session) => buildPlatformParityReport({ businessId: session.businessId }), { manager: true });
