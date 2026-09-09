import { completeEmbeddedSignup } from "@/lib/meta-onboarding";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request) { return completeEmbeddedSignup(request); }