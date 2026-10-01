import { getAutomationFlows, saveAutomationFlow } from "@/lib/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { withWorkspaceFeature } from '@/lib/feature-controls';
export const GET = withWorkspaceFeature('automation', getAutomationFlows);
export const POST = withWorkspaceFeature('automation', saveAutomationFlow);
