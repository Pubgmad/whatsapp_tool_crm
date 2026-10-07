import { honestLimitsPayload } from '@/lib/honest-product-limits.js';
import { workspaceRoute } from '@/lib/workspace-route.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async () => honestLimitsPayload(), { cacheSeconds: 120 });
