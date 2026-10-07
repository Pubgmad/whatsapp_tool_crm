import { workspaceResultsManagerBundle } from '@/lib/workspace-results-bundle.js';
import { workspaceRoute } from '@/lib/workspace-route.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session) => {
  const deepProbe = new URL(request.url).searchParams.get('probe') === '1';
  return workspaceResultsManagerBundle(session.businessId, { deepProbe });
}, { manager: true });
