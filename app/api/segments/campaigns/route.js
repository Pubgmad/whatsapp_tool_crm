import { getAudienceCampaignOptions } from '@/lib/segments';
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withWorkspaceFeature('segments', getAudienceCampaignOptions);
