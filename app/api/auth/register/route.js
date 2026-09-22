import { createSessionToken, registerAccount, sessionCookie } from "@/lib/auth";
import { errorJson, json } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    const body = await request.json();
    await enforceRequestRateLimit(request, String(body.email || '').toLowerCase(), 'login');
    const session = await registerAccount(body);
    if (process.env.EMAIL_VERIFICATION_REQUIRED === 'true') {
      const { issueVerification } = await import('@/lib/account-security');
      try {
        const verification = await issueVerification(session.userId);
        return json({ ok: true, verificationRequired: true, developmentUrl: verification.developmentUrl || '' }, 201);
      } catch (deliveryError) {
        return json({ ok: true, verificationRequired: true, deliveryFailed: true }, 202);
      }
    }
    return json({ ok: true }, 201, { "Set-Cookie": sessionCookie(createSessionToken(session)) });
  } catch (error) {
    return errorJson(error);
  }
}

