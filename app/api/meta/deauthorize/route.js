import { handleMetaDeauthorize } from "@/lib/meta-data-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "ready", method: "POST" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  return handleMetaDeauthorize(request);
}
