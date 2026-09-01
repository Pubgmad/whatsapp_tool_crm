import { sendTemplateReply } from "@/lib/actions";
export const dynamic = "force-dynamic";
export async function POST(request) { return sendTemplateReply(request); }
