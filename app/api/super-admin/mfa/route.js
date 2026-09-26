import { errorJson, json } from '@/lib/db';
import { getSuperAdminMfa, manageSuperAdminMfa } from '@/lib/super-admin';
import { readJsonBodyLimited } from '@/lib/security';

export async function GET(request) {
  try { return json(await getSuperAdminMfa(request)); }
  catch (error) { return errorJson(error); }
}

export async function POST(request) {
  try { return json(await manageSuperAdminMfa(request, await readJsonBodyLimited(request, 16384))); }
  catch (error) { return errorJson(error); }
}
