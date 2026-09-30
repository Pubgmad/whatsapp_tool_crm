import { errorJson } from "@/lib/db";
import { changeSuperAdminPrivacyPolicy, getSuperAdminPrivacyPolicy } from "@/lib/super-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try { return await getSuperAdminPrivacyPolicy(request); }
  catch (error) { return errorJson(error); }
}

export async function POST(request) {
  try { return await changeSuperAdminPrivacyPolicy(request); }
  catch (error) { return errorJson(error); }
}
