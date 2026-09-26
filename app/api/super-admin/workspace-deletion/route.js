import { errorJson } from "@/lib/db";
import { listWorkspaceDeletionRequests, reviewWorkspaceDeletionRequest } from "@/lib/workspace-deletion-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try { return await listWorkspaceDeletionRequests(request); }
  catch (error) { return errorJson(error); }
}

export async function PATCH(request) {
  try { return await reviewWorkspaceDeletionRequest(request); }
  catch (error) { return errorJson(error); }
}
