import { workspaceIntegrationMarketplace } from '@/lib/integration-marketplace.js';
import { workspaceRoute } from '@/lib/workspace-route.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_request, session) => workspaceIntegrationMarketplace(session.businessId), { cacheSeconds: 60 });
