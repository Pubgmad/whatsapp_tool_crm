import { requireSession } from '@/lib/auth';
import { errorJson, json } from '@/lib/db';
import { buildPlatformParityReport } from '@/lib/parity-report.js';
import { requireWorkspaceManager } from '@/lib/workspace-permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const businessId = session.businessId;
    return json(await buildPlatformParityReport({ businessId }));
  } catch (error) {
    return errorJson(error);
  }
}
