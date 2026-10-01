import { errorJson } from '../../../../../../lib/db';
import { updateCompanyFeature } from '../../../../../../lib/super-admin';

export const runtime = 'nodejs';
export async function PATCH(request, context) {
  try { return await updateCompanyFeature(request, context); }
  catch (error) { return errorJson(error); }
}
