import { getState } from "@/lib/actions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) { return getState(request); }

