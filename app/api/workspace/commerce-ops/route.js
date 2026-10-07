import { workspaceRoute } from '@/lib/workspace-route.ts';
import { commerceOperationsCenter } from '@/lib/commerce-operations-center.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (_request, session) => commerceOperationsCenter(session.businessId), { manager: true });
