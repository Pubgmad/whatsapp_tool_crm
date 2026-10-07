import { requireSession } from '@/lib/auth.js';
import { errorJson, json } from '@/lib/db.js';
import { honestLimitsPayload } from '@/lib/honest-product-limits.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await requireSession(request);
    return json(honestLimitsPayload());
  } catch (error) {
    return errorJson(error);
  }
}
