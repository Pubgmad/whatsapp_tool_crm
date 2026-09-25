import { errorJson } from "@/lib/db";
import { listMyWorkspaces, switchWorkspace } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try { return await listMyWorkspaces(request); }
  catch (error) { return errorJson(error); }
}

export async function POST(request) {
  try { return await switchWorkspace(request); }
  catch (error) { return errorJson(error); }
}
