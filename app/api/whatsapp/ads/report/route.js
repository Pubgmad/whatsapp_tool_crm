import { requireSession } from '@/lib/auth.js';
import { errorJson, json } from '@/lib/db.js';
import { whatsappAdsPerformanceSummary, whatsappAdsReadiness } from '@/lib/whatsapp-ads-report.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const session = await requireSession(request);
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
