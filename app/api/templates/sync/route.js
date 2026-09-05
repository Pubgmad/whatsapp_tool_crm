import { syncTemplatesFromMeta } from "@/lib/actions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) { return syncTemplatesFromMeta(request); }
