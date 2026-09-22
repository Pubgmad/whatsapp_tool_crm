import { clearSessionCookie } from "@/lib/auth";
import { json } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  const { assertCsrf } = await import('@/lib/security');
  assertCsrf(request);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

