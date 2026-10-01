import { createCampaign } from "@/lib/actions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { withWorkspaceFeature } from '@/lib/feature-controls';
export const POST = withWorkspaceFeature('campaigns', createCampaign);


