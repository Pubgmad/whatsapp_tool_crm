import { clearSessionCookie } from "@/lib/auth";
import { json } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST() {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

