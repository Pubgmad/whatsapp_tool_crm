import { createSessionToken, registerAccount, sessionCookie } from "@/lib/auth";
import { errorJson, json } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  try {
    const session = await registerAccount(await request.json());
    return json({ ok: true }, 201, { "Set-Cookie": sessionCookie(createSessionToken(session)) });
  } catch (error) {
    return errorJson(error);
  }
}

