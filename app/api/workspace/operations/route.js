import { requireSession } from '@/lib/auth';
import { errorJson, json } from '@/lib/db';
import { workspaceOperationsReport } from '@/lib/workspace-operations-report.js';
import { requireWorkspaceManager } from '@/lib/workspace-permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    return json(await workspaceOperationsReport(session.businessId));
  } catch (error) {
    return errorJson(error);
  }
}
