import { revokeTeamInvitation } from "@/lib/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request, context) { return revokeTeamInvitation(request, { params: await context.params }); }