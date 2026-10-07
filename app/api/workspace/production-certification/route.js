import { requireSession } from '@/lib/auth';
import { errorJson, json } from '@/lib/db';
import { workspaceProductionCertification } from '@/lib/production-certification.js';
import { requireWorkspaceManager } from '@/lib/workspace-permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    return json(await workspaceProductionCertification(session.businessId));
  } catch (error) {
    return errorJson(error);
  }
}
