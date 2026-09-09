import { acceptTeamInvitation } from "@/lib/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request, context) { return acceptTeamInvitation(request, { params: await context.params }); }