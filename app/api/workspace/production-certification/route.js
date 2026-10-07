import { workspaceProductionCertification } from '@/lib/production-certification.js';
import { workspaceRoute } from '@/lib/workspace-route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session) => {
  const deepProbe = new URL(request.url).searchParams.get('probe') === '1';
  return workspaceProductionCertification(session.businessId, { deepProbe });
}, { manager: true });
