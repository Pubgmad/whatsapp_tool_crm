import { processAllQueuesJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) { return processAllQueuesJob(request); }
