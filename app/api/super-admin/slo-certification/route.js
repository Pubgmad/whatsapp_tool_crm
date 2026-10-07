import { requireSuperAdmin } from '@/lib/super-admin.js';
import { errorJson, json } from '@/lib/db.js';
import {
  computePlatformSloCertification,
  latestPlatformSloCertification,
  recordPlatformSloCertificationRun
} from '@/lib/slo-certification.js';
import { readJsonBodyLimited } from '@/lib/security.js';
import { AppError } from '@/lib/db.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const admin = await requireSuperAdmin(request);
    const live = await computePlatformSloCertification();
    const last = await latestPlatformSloCertification();
    return json({ live, last, requestedBy: admin.id });
  } catch (error) {
    return errorJson(error);
  }
}

export async function POST(request) {
  try {
    const admin = await requireSuperAdmin(request);
    const body = await readJsonBodyLimited(request, 4000);
    if (body.action !== 'record') throw new AppError('Unknown action.', 400, 'VALIDATION_ERROR');
    const result = await recordPlatformSloCertificationRun({ createdBy: admin.id });
    return json(result, 201);
  } catch (error) {
    return errorJson(error);
  }
}
