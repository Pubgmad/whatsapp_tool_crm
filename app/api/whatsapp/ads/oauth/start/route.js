import { startAdsOAuth } from '@/lib/ads-meta-oauth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Do not wrap with withWorkspaceFeature — startAdsOAuth already enforces session + ads feature,
// and the outer wrapper was returning raw Postgres 42501 before mapped AppErrors.
export const GET = startAdsOAuth;
export const POST = startAdsOAuth;
