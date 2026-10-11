import { cookies } from "next/headers";
import { errorJson, json } from "../../../../lib/db";
import { loginSuperAdmin, SUPER_SESSION_COOKIE_NAME, superSessionCookie } from "../../../../lib/super-admin";
import { readJsonBodyLimited, secureCookieAttribute } from "../../../../lib/security";

export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('../../../../lib/security');
    assertCsrf(request);
    const body = await readJsonBodyLimited(request, 16384);
    await enforceRequestRateLimit(request, String(body.email || '').toLowerCase(), 'login');
    const result = await loginSuperAdmin({ email: body.email, password: body.password, mfaCode: body.mfaCode });
    const jar = await cookies();
    jar.set({
      name: SUPER_SESSION_COOKIE_NAME,
      value: result.token,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: secureCookieAttribute().includes('Secure')
    });
    // Also emit Set-Cookie for runtimes that only forward explicit response headers.
    return json({ admin: result.admin }, 200, { "Set-Cookie": superSessionCookie(result.token) });
  } catch (error) {
    return errorJson(error);
  }
}
