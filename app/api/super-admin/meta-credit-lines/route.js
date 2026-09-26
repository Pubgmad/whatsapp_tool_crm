import { getMetaCreditLines } from "@/lib/meta-credit-lines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  return getMetaCreditLines(request);
}
