import { workspaceRoute } from '@/lib/workspace-route.ts';
import { journeyUnifiedReport } from '@/lib/journey-unified-report.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session) => {
  const limit = Number(new URL(request.url).searchParams.get('limit') || 50);
  return { rows: await journeyUnifiedReport(session.businessId, { limit }) };
}, { manager: true });
