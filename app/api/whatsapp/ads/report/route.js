import { withWorkspaceFeature } from '@/lib/feature-controls.js';
import { requireSession } from '@/lib/auth.js';
import { errorJson, json } from '@/lib/db.js';
import { whatsappAdsPerformanceSummary, whatsappAdsReadiness } from '@/lib/whatsapp-ads-report.js';
import { requireWorkspaceManager } from '@/lib/workspace-permissions.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function adsReportGet(request) {
  try {
    const session = await requireSession(request);
    requireWorkspaceManager(session);
    const params = new URL(request.url).searchParams;
    const days = Number(params.get('days') || 30);
    const [readiness, performance] = await Promise.all([
      whatsappAdsReadiness(session.businessId),
      whatsappAdsPerformanceSummary(session.businessId, { days })
    ]);
    return json({ readiness, performance });
  } catch (error) {
    return errorJson(error);
  }
}

export const GET = withWorkspaceFeature('ads', adsReportGet);
