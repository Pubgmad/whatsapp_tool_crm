import { errorJson } from "@/lib/db";
import { listMetaDeletionRequests, reviewMetaDeletionRequest } from "@/lib/meta-deletion-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try { return await listMetaDeletionRequests(request); }
  catch (error) { return errorJson(error); }
}

export async function PATCH(request) {
  try { return await reviewMetaDeletionRequest(request); }
  catch (error) { return errorJson(error); }
}
