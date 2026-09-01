import { getMe } from "@/lib/actions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) { return getMe(request); }

