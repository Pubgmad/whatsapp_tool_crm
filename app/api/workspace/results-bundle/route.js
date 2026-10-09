import { URL } from 'node:url';
import { workspaceResultsManagerBundle } from '@/lib/workspace-results-bundle.js';
import { workspaceRoute } from '@/lib/workspace-route.ts';
import { campaignSourceFilter } from '@/lib/campaign-source.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session) => {
  const searchParams = new URL(request.url).searchParams;
  const deepProbe = searchParams.get('probe') === '1';
  return workspaceResultsManagerBundle(session.businessId, { deepProbe, ...campaignSourceFilter(searchParams) });
}, { manager: true });
