import { getCampaignRecipients } from "@/lib/campaign-recipients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  return getCampaignRecipients(request, context);
}
