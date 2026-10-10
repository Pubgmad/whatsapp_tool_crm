import { adCreditsRequest } from '@/lib/ad-credits.js';
import { withWorkspaceFeature } from '@/lib/feature-controls.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withWorkspaceFeature('ads', adCreditsRequest);
export const POST = withWorkspaceFeature('ads', adCreditsRequest);
