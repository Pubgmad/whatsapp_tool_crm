import { getAdsOAuthPending } from '@/lib/ads-meta-oauth.js';
import { withWorkspaceFeature } from '@/lib/feature-controls.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withWorkspaceFeature('ads', getAdsOAuthPending);
