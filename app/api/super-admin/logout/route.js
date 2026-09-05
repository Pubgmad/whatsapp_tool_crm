import { json } from "../../../../lib/db";
import { clearSuperSessionCookie } from "../../../../lib/super-admin";

export async function POST() {
  return json({ ok: true }, 200, { "Set-Cookie": clearSuperSessionCookie() });
}
