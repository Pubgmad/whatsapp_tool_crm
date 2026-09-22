import { json } from "../../../../lib/db";
import { clearSuperSessionCookie } from "../../../../lib/super-admin";

export async function POST(request) {
  const { assertCsrf } = await import('../../../../lib/security');
  assertCsrf(request);
  return json({ ok: true }, 200, { "Set-Cookie": clearSuperSessionCookie() });
}
