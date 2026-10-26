import { updateCampaignLifecycle } from "@/lib/actions";
import { withWorkspaceFeature } from "@/lib/feature-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, context) {
  const params = await context.params;
  return withWorkspaceFeature("campaigns", (req) =>
    updateCampaignLifecycle(req, { params })
  )(request);
}
