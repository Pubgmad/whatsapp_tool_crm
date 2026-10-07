import { requireSession } from '@/lib/auth.js';
import { errorJson, json } from '@/lib/db.js';
import { workspaceProductionHub } from '@/lib/workspace-production-hub.js';
import { requireWorkspaceManager } from '@/lib/workspace-permissions.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    return json(await workspaceProductionHub(session.businessId));
  } catch (error) {
    return errorJson(error);
  }
}
