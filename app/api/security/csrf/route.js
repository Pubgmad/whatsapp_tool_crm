import { createCsrfToken, csrfCookie, enforceRequestRateLimit } from '@/lib/security';
import { errorJson, json } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await enforceRequestRateLimit(request, 'csrf', 'api');
    const token = createCsrfToken();
    return json({ csrfToken: token }, 200, { 'Set-Cookie': csrfCookie(token) });
  } catch (error) { return errorJson(error); }
}
