import { referralReportDays, referralSummaryForBusiness } from '@/lib/whatsapp-referral-report.js';
import { workspaceRoute } from '@/lib/workspace-route.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = workspaceRoute(async (request, session) => {
  const days = referralReportDays(new URL(request.url).searchParams.get('days'));
  return {
    periodDays: days,
    sources: await referralSummaryForBusiness(session.businessId, days)
  };
}, { manager: true });
