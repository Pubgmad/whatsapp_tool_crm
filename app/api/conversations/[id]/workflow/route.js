import { updateConversationWorkflow } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, context) { return updateConversationWorkflow(request, { params: await context.params }); }
