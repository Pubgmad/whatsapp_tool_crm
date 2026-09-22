import { errorJson, json } from "../../../../lib/db";
import { loginSuperAdmin, superSessionCookie } from "../../../../lib/super-admin";

export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('../../../../lib/security');
    assertCsrf(request);
    const body = await request.json();
    await enforceRequestRateLimit(request, String(body.email || '').toLowerCase(), 'login');
    const result = await loginSuperAdmin({ email: body.email, password: body.password, mfaCode: body.mfaCode });
    return json({ admin: result.admin }, 200, { "Set-Cookie": superSessionCookie(result.token) });
  } catch (error) {
    return errorJson(error);
  }
}
