import { getTemplateInsights } from "@/lib/whatsapp-template-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const { id } = await context.params;
  return getTemplateInsights(request, id);
}
