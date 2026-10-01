import { createSessionToken, registerAccount, sessionCookie } from "@/lib/auth";
import { enterTenantContext, errorJson, id, json, query } from "@/lib/db";
import { readJsonBodyLimited } from "@/lib/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) {
  try {
    const { assertCsrf, enforceRequestRateLimit } = await import('@/lib/security');
    assertCsrf(request);
    const body = await readJsonBodyLimited(request, 16384);
    await enforceRequestRateLimit(request, String(body.email || '').toLowerCase(), 'login');
    const session = await registerAccount(body);
    if ((await import('@/lib/auth')).emailVerificationRequired()) {
      const { issueVerification } = await import('@/lib/account-security');
      try {
        const verification = await issueVerification(session.userId);
        return json({ ok: true, verificationRequired: true, developmentUrl: verification.developmentUrl || '' }, 201);
      } catch (deliveryError) {
        const code = typeof deliveryError?.code === 'string' ? deliveryError.code : 'EMAIL_DELIVERY_FAILED';
        console.error('Registration verification delivery failed', { businessId: session.businessId, code });
        try {
          enterTenantContext(session.businessId);
          await query('INSERT INTO audit_logs (id,business_id,user_id,action,metadata) VALUES ($1,$2,$3,$4,$5)', [
            id('a'), session.businessId, session.userId, 'verification_delivery_failed', JSON.stringify({ code })
          ]);
        } catch (auditError) {
          console.error('Verification delivery audit failed', { businessId: session.businessId, code: auditError?.code || 'AUDIT_FAILED' });
        }
        return json({ ok: true, verificationRequired: true, deliveryFailed: true }, 202);
      }
    }
    return json({ ok: true }, 201, { "Set-Cookie": sessionCookie(createSessionToken(session)) });
  } catch (error) {
    return errorJson(error);
  }
}

