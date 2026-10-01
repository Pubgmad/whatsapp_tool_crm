import { deleteAutomationFlow, patchAutomationFlow, saveAutomationFlow } from "@/lib/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { withWorkspaceFeature } from '@/lib/feature-controls';
export const PUT = withWorkspaceFeature('automation', async (request, context) => saveAutomationFlow(request, { params: await context.params }));
export const PATCH = withWorkspaceFeature('automation', async (request, context) => patchAutomationFlow(request, { params: await context.params }));
export async function DELETE(request, context) { return deleteAutomationFlow(request, { params: await context.params }); }
