import { errorJson } from '../../../../lib/db';
import { getSuperAdminParityReport } from '../../../../lib/super-admin';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    return await getSuperAdminParityReport(request);
  } catch (error) {
    return errorJson(error);
  }
}
