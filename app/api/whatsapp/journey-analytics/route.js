import { getJourneyAnalytics } from '@/lib/whatsapp-journey-analytics';
import { withWorkspaceFeature } from '@/lib/feature-controls';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = withWorkspaceFeature('automation', getJourneyAnalytics);
