import { requireSuperAdmin } from '@/lib/super-admin.js';
import { errorJson, json } from '@/lib/db.js';
import { capabilityImprovementBacklog, improvementBacklogSummary } from '@/lib/improvement-backlog.js';
import { honestLimitsPayload } from '@/lib/honest-product-limits.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await requireSuperAdmin(request);
    const backlog = capabilityImprovementBacklog();
    return json({
      ...improvementBacklogSummary(backlog),
      items: backlog,
      honestLimits: honestLimitsPayload(),
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return errorJson(error);
  }
}
