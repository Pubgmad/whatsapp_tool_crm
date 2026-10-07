import { requireSession } from '@/lib/auth.js';
import { errorJson, json } from '@/lib/db.js';
import { workspaceIntegrationMarketplace } from '@/lib/integration-marketplace.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireSession(request);
    const marketplace = await workspaceIntegrationMarketplace(session.businessId);
    return json(marketplace);
  } catch (error) {
    return errorJson(error);
  }
}
