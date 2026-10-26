import { getCampaignRecipients } from "@/lib/campaign-recipients";
import { withWorkspaceFeature } from "@/lib/feature-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  return withWorkspaceFeature("campaigns", (req) => getCampaignRecipients(req, context))(request);
}
