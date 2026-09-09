import { updateCampaignLifecycle } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, context) {
  return updateCampaignLifecycle(request, { params: await context.params });
}