import { processAutomationQueue } from "@/lib/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) { return processAutomationQueue(request); }
