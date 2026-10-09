import { URL } from 'node:url';
import { workspaceRoute } from '@/lib/workspace-route.ts';
import { journeyUnifiedReport } from '@/lib/journey-unified-report.js';
import { campaignSourceFilter } from '@/lib/campaign-source.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session) => {
  const searchParams = new URL(request.url).searchParams;
  const limit = Number(searchParams.get('limit') || 50);
  const source = campaignSourceFilter(searchParams);
  return { rows: await journeyUnifiedReport(session.businessId, { limit, ...source }), filters: source };
}, { manager: true });
