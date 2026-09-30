import { getMetaCreditLines, shareMetaCreditLine } from "@/lib/meta-credit-lines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  return getMetaCreditLines(request);
}

export async function POST(request) {
  return shareMetaCreditLine(request);
}
