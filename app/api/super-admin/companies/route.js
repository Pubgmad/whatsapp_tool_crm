import { errorJson } from "@/lib/db";
import { getSuperAdminCompanies } from "@/lib/super-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try { return await getSuperAdminCompanies(request); }
  catch (error) { return errorJson(error); }
}
