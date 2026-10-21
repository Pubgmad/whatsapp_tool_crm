import { errorJson } from '../../../../../lib/db';
import { ensureSuperAdminDefaultPlans } from '../../../../../lib/super-admin';

export async function POST(request) {
  try {
    return await ensureSuperAdminDefaultPlans(request);
  } catch (error) {
    return errorJson(error);
  }
}
