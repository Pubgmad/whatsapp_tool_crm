import { errorJson, json } from '@/lib/db';
import { getSuperAdminMfa, manageSuperAdminMfa } from '@/lib/super-admin';

export async function GET(request) {
  try { return json(await getSuperAdminMfa(request)); }
  catch (error) { return errorJson(error); }
}

export async function POST(request) {
  try { return json(await manageSuperAdminMfa(request, await request.json())); }
  catch (error) { return errorJson(error); }
}
