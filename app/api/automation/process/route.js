import { processAutomationQueue } from "@/lib/automation";
import { withWorkspaceFeature } from "@/lib/feature-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  return withWorkspaceFeature("automation", processAutomationQueue)(request);
}
