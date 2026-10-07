import { requireSession } from '@/lib/auth.js';
import { requireWorkspaceManager } from '@/lib/workspace-permissions.js';
import { AppError, errorJson, json, query, transaction } from '@/lib/db.js';
import { syncCampaignAudienceFromSegment } from '@/lib/campaign-audience-sync.js';
import { withWorkspaceFeature } from '@/lib/feature-controls.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function syncAudience(request, context) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const { id: campaignId } = await context.params;
    const campaign = (await query('SELECT audience_segment_id, dynamic_audience FROM campaigns WHERE id=$1 AND business_id=$2', [campaignId, session.businessId])).rows[0];
    if (!campaign) throw new AppError('Campaign not found.', 404, 'CAMPAIGN_NOT_FOUND');
    if (!campaign.audience_segment_id) throw new AppError('This campaign is not linked to a dynamic audience segment.', 409, 'CAMPAIGN_AUDIENCE_STATIC');
    const result = await transaction((client) => syncCampaignAudienceFromSegment(session.businessId, campaignId, client));
    return json({ ok: true, ...result });
  } catch (error) {
    return errorJson(error);
  }
}

export async function POST(request, context) {
  return withWorkspaceFeature('segments', (req) => syncAudience(req, context))(request);
}
