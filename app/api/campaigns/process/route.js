import { processCampaignQueue } from "@/lib/actions";
import { withWorkspaceFeature } from '@/lib/feature-controls';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) { return withWorkspaceFeature('campaigns', processCampaignQueue)(request); }
