import { getWhatsAppReferralReport } from "@/lib/whatsapp-referral-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  return getWhatsAppReferralReport(request);
}
