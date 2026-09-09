import { removeTeamMember, updateTeamMember } from "@/lib/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(request, context) { return updateTeamMember(request, { params: await context.params }); }
export async function DELETE(request, context) { return removeTeamMember(request, { params: await context.params }); }