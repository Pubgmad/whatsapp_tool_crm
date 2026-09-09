import { getEmbeddedSignupConfig } from "@/lib/meta-onboarding";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) { return getEmbeddedSignupConfig(request); }