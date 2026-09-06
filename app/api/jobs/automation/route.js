import { processAutomationQueueJob } from "@/lib/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) { return processAutomationQueueJob(request); }
