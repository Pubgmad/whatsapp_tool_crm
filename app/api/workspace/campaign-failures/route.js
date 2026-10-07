import { requireSession } from '@/lib/auth.js';
import { errorJson, json } from '@/lib/db.js';
import { campaignFailedRecipientsWorkbench } from '@/lib/campaign-failed-workbench.js';
import { requireWorkspaceManager } from '@/lib/workspace-permissions.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const limit = Number(new URL(request.url).searchParams.get('limit') || 75);
    return json(await campaignFailedRecipientsWorkbench(session.businessId, limit));
  } catch (error) {
    return errorJson(error);
  }
}
