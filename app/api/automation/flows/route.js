import { getAutomationFlows, saveAutomationFlow } from "@/lib/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) { return getAutomationFlows(request); }
export async function POST(request) { return saveAutomationFlow(request); }
