import { getMessageMedia } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  return getMessageMedia(request, { params: await context.params });
}