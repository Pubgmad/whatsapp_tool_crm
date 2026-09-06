import { deleteAutomationFlow, patchAutomationFlow, saveAutomationFlow } from "@/lib/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request, context) { return saveAutomationFlow(request, { params: await context.params }); }
export async function PATCH(request, context) { return patchAutomationFlow(request, { params: await context.params }); }
export async function DELETE(request, context) { return deleteAutomationFlow(request, { params: await context.params }); }
