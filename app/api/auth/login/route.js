import { createSessionToken, loginAccount, sessionCookie } from "@/lib/auth";
import { errorJson, json } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    const body = await request.json();
    await enforceRequestRateLimit(request, String(body.email || '').toLowerCase(), 'login');
    const session = await loginAccount(body);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(createSessionToken(session)) });
  } catch (error) {
    return errorJson(error);
  }
}

