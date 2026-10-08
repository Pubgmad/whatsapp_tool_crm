import { requireSession } from '../../../../lib/auth.js';
import { errorJson, json } from '../../../../lib/db.js';
import { requireWorkspaceManager } from '../../../../lib/workspace-permissions.js';
import { flowScreenDropOffForBusiness, flowScreenFunnelForBusiness } from '../../../../lib/flow-screen-analytics.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const params = new URL(request.url).searchParams;
    const flowId = String(params.get('flowId') || '').slice(0, 80);
    const funnel = await flowScreenFunnelForBusiness(session.businessId);
    let dropOff = await flowScreenDropOffForBusiness(session.businessId);
    if (flowId) dropOff = dropOff.filter((row) => row.flow_id === flowId);
    return json({ funnel, dropOff, generatedAt: new Date().toISOString() });
  } catch (error) {
    return errorJson(error);
  }
}
