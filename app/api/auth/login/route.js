import { createSessionToken, loginAccount, sessionCookie } from "@/lib/auth";
import { errorJson, json } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  try {
    const session = await loginAccount(await request.json());
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(createSessionToken(session)) });
  } catch (error) {
    return errorJson(error);
  }
}

