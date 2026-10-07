import { requireSuperAdmin } from '@/lib/super-admin.js';
import { errorJson, json } from '@/lib/db.js';
import { platformA11yCertificationStatus } from '@/lib/a11y-certification.js';
import { honestLimitById } from '@/lib/honest-product-limits.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    const status = await platformA11yCertificationStatus();
    return json({
      ...status,
      boundary: honestLimitById('a11y_certification')
    });
  } catch (error) {
    return errorJson(error);
  }
}
