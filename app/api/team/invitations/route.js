import { createTeamInvitation, getTeamInvitations } from "@/lib/team";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) { return getTeamInvitations(request); }
export async function POST(request) { return createTeamInvitation(request); }